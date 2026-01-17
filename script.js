// Данные приложения
let items = {
    daily: [],
    master: [],
    weekly: [],
    rules: [],
    bans: []
};

let currentTab = 'daily';
let editingItemId = null;
let calendarId = null;
let unsubscribeFirestore = null;
let isInitialized = false;
let calendar = null;
let messaging = null;
let fcmToken = null;
let tokenSaveRetryCount = 0;
let tokenSaveRetryTimeout = null;
let lastTokenCheckTime = null;
let notificationSystemStatus = 'unknown'; // 'working', 'degraded', 'failed', 'unknown'

// Флаг блокировки приложения (для разработки)
// По умолчанию включен (true) - приложение заблокировано
// Чтобы выключить блокировку и вернуться к разработке:
//   localStorage.setItem('appMaintenanceMode', 'false')
//   window.location.reload()
// Чтобы включить блокировку обратно:
//   localStorage.setItem('appMaintenanceMode', 'true')
//   window.location.reload()
function isMaintenanceMode() {
    // Если флаг не установлен, по умолчанию включаем режим обслуживания
    const flag = localStorage.getItem('appMaintenanceMode');
    if (flag === null) {
        localStorage.setItem('appMaintenanceMode', 'true');
        return true;
    }
    return flag === 'true';
}

function showMaintenanceOverlay() {
    const overlay = document.getElementById('maintenance-overlay');
    if (overlay) {
        overlay.classList.remove('hidden');
    }
}

function hideMaintenanceOverlay() {
    const overlay = document.getElementById('maintenance-overlay');
    if (overlay) {
        overlay.classList.add('hidden');
    }
}

// Глобальная функция для переключения режима обслуживания (для удобства разработчика)
window.toggleMaintenanceMode = function(enable) {
    if (enable === undefined) {
        // Переключаем на противоположное значение
        const current = isMaintenanceMode();
        localStorage.setItem('appMaintenanceMode', (!current).toString());
        console.log(`Режим обслуживания ${!current ? 'включен' : 'выключен'}. Перезагрузите страницу.`);
    } else {
        localStorage.setItem('appMaintenanceMode', enable.toString());
        console.log(`Режим обслуживания ${enable ? 'включен' : 'выключен'}. Перезагрузите страницу.`);
    }
    return isMaintenanceMode();
};

// Инициализация
document.addEventListener('DOMContentLoaded', async () => {
    // Проверяем режим обслуживания
    if (isMaintenanceMode()) {
        showMaintenanceOverlay();
        console.log('%c🔴 РЕЖИМ ОБСЛУЖИВАНИЯ АКТИВЕН', 'color: red; font-size: 16px; font-weight: bold;');
        console.log('%cЧтобы отключить режим обслуживания и вернуться к разработке:', 'color: orange; font-size: 14px;');
        console.log('localStorage.setItem("appMaintenanceMode", "false"); window.location.reload();');
        console.log('Или используйте: window.toggleMaintenanceMode(false); window.location.reload();');
        // Блокируем весь функционал
        return;
    }
    
    hideMaintenanceOverlay();
    
    // Загружаем сохраненную тему
    const savedTheme = localStorage.getItem('theme') || 'light';
    if (savedTheme === 'dark') {
        document.documentElement.classList.add('dark');
    }
    updateThemeIcon(savedTheme === 'dark');
    
    // Регистрация Service Worker для PWA
    registerServiceWorker();
    
    // Инициализируем календарь для получения calendarId (нужно для сохранения токена)
    await initializeCalendar();
    
    // Диагностика PWA при загрузке
    console.log('[PWA] Проверка статуса PWA при загрузке...');
    const pwaStatus = isPWAInstalled();
    console.log('[PWA] Приложение установлено как PWA:', pwaStatus);
    console.log('[PWA] User Agent:', navigator.userAgent);
    console.log('[PWA] Window dimensions:', window.innerWidth, 'x', window.innerHeight);
    console.log('[PWA] Screen dimensions:', window.screen.width, 'x', window.screen.height);
    
    // Инициализируем приложение
            setupTabs();
            setupForm();
            initFullCalendar();
            checkReminders();
            setupReminderCheck();
            
            // Инициализируем шкалу прогресса
            updateProgressHeart();
            
    // Запускаем умную проверку напоминаний (работает как fallback, если FCM не работает)
    startSmartReminderCheck();
    
    // Инициализируем FCM, если разрешение уже дано
    if ('Notification' in window && Notification.permission === 'granted' && calendarId) {
        initializeFirebaseMessaging();
    }
    
    // Обработчик восстановления подключения
    window.addEventListener('online', async () => {
        console.log('[FCM] 🌐 Подключение восстановлено');
        // Пытаемся сохранить отложенный токен, если есть
        const pendingToken = localStorage.getItem('pendingFCMToken');
        if (pendingToken && calendarId) {
            console.log('[FCM] 🔄 Сохранение отложенного токена после восстановления подключения...');
            await saveFCMToken(pendingToken, true);
        }
        // Также пытаемся сохранить текущий токен, если он есть
        if (fcmToken && calendarId) {
            console.log('[FCM] 🔄 Обновление токена после восстановления подключения...');
            await saveFCMToken(fcmToken, true);
        }
        // Проверяем и обновляем токен при восстановлении подключения
        if (messaging && calendarId && Notification.permission === 'granted') {
            try {
                const registration = serviceWorkerRegistration || await navigator.serviceWorker.ready;
                const currentToken = await messaging.getToken({
                    serviceWorkerRegistration: registration
                });
                if (currentToken && currentToken !== fcmToken) {
                    console.log('[FCM] 🔄 Обнаружен новый токен после восстановления подключения');
                    fcmToken = currentToken;
                    await saveFCMToken(currentToken, true);
                }
            } catch (error) {
                console.error('[FCM] Ошибка проверки токена после восстановления подключения:', error);
            }
        }
    });
    
    // Обработчик потери подключения
    window.addEventListener('offline', () => {
        console.warn('[FCM] ⚠️ Подключение потеряно, работаем в офлайн-режиме');
        updateNotificationSystemStatus('degraded');
    });
});

// Инициализация календаря
async function initializeCalendar() {
    // Получаем calendarId из URL
    const urlParams = new URLSearchParams(window.location.search);
    calendarId = urlParams.get('c');
    
    // Если calendarId есть в URL, сохраняем его в localStorage
    if (calendarId) {
        localStorage.setItem('calendarId', calendarId);
    } else {
        // Если нет в URL, проверяем localStorage
        calendarId = localStorage.getItem('calendarId');
        
        if (!calendarId) {
            // Создаем новый calendarId
            calendarId = generateCalendarId();
            localStorage.setItem('calendarId', calendarId);
        }
        
        // Обновляем URL без перезагрузки страницы
        const newUrl = window.location.origin + window.location.pathname + '?c=' + calendarId;
        window.history.replaceState({}, '', newUrl);
    }
    
    // Показываем информацию о календаре
    
    // Загружаем данные из Firebase
    await loadDataFromFirebase();
    
    isInitialized = true;
}

// Генерация уникального ID календаря
function generateCalendarId() {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

// Получение локальной даты в формате YYYY-MM-DD (не UTC)
function getLocalDateString(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// Глобальная переменная для хранения регистрации Service Worker
let serviceWorkerRegistration = null;

// Регистрация Service Worker для PWA
async function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        try {
            // Определяем базовый путь для GitHub Pages
            // Убираем имя файла и лишние слэши из пути
            let basePath = window.location.pathname.replace(/\/[^\/]*$/, '') || '/';
            // Убираем завершающий слэш, если он есть (кроме корня)
            if (basePath !== '/' && basePath.endsWith('/')) {
                basePath = basePath.slice(0, -1);
            }
            const swPath = `${basePath}/sw.js`;
            const swScope = basePath === '/' ? '/' : `${basePath}/`;
            
            serviceWorkerRegistration = await navigator.serviceWorker.register(swPath, {
                scope: swScope
            });
            console.log('[PWA] Service Worker зарегистрирован:', serviceWorkerRegistration.scope);

            // Проверка обновлений при загрузке страницы
            if (serviceWorkerRegistration.waiting) {
                // Если есть ожидающий Service Worker, активируем его сразу
                serviceWorkerRegistration.waiting.postMessage({ type: 'SKIP_WAITING' });
            }
            
            // Проверка обновлений
            serviceWorkerRegistration.addEventListener('updatefound', () => {
                const newWorker = serviceWorkerRegistration.installing;
                newWorker.addEventListener('statechange', () => {
                    if (newWorker.state === 'installed') {
                        if (navigator.serviceWorker.controller) {
                            // Новый Service Worker доступен, активируем автоматически
                            console.log('[PWA] Доступна новая версия приложения, обновляем автоматически');
                            newWorker.postMessage({ type: 'SKIP_WAITING' });
                            // Перезагружаем страницу через небольшую задержку
                            setTimeout(() => {
                                window.location.reload();
                            }, 100);
                        } else {
                            // Первая установка
                            console.log('[PWA] Service Worker установлен впервые');
                        }
                    }
                });
            });
            
            // Периодическая проверка обновлений (каждые 60 секунд)
            setInterval(() => {
                serviceWorkerRegistration.update();
            }, 60000);

            // Firebase Messaging будет использовать тот же Service Worker (sw.js)
            // Не нужно регистрировать отдельный firebase-messaging-sw.js
        } catch (error) {
            console.error('[PWA] Ошибка регистрации Service Worker:', error);
        }
    } else {
        console.warn('[PWA] Service Worker не поддерживается');
    }
}

// Инициализация Firebase Cloud Messaging
async function initializeFirebaseMessaging() {
    if (!('Notification' in window)) {
        console.warn('[FCM] Уведомления не поддерживаются');
        return;
    }

    try {
        console.log('[FCM] Начало инициализации Firebase Cloud Messaging');
        
        // Проверяем текущее разрешение
        let permission = Notification.permission;
        console.log('[FCM] Текущее разрешение:', permission);
        
        // Запрашиваем разрешение на уведомления, если еще не запрашивали
        if (permission === 'default') {
            permission = await Notification.requestPermission();
            console.log('[FCM] Результат запроса разрешения:', permission);
        }
        
        if (permission !== 'granted') {
            console.warn('[FCM] Разрешение на уведомления не предоставлено:', permission);
            console.warn('[FCM] Push-уведомления не будут работать. Разрешите уведомления в настройках браузера.');
            return;
        }

        // Получаем токен FCM
        const messaging = firebase.messaging();
        console.log('[FCM] Firebase Messaging инициализирован');
        
        // Ждем готовности Service Worker и передаем его в getToken
        // Это нужно, чтобы Firebase использовал существующий Service Worker
        // вместо попытки зарегистрировать firebase-messaging-sw.js
        let registration = serviceWorkerRegistration;
        if (!registration) {
            console.log('[FCM] Ожидание готовности Service Worker...');
            registration = await navigator.serviceWorker.ready;
            console.log('[FCM] Service Worker готов:', registration);
        } else {
            console.log('[FCM] Service Worker уже зарегистрирован');
        }

        // Получаем токен с указанием Service Worker регистрации
        // VAPID ключ не нужен для Firebase Cloud Messaging - он используется автоматически
        console.log('[FCM] Получение FCM токена...');
        fcmToken = await messaging.getToken({
            serviceWorkerRegistration: registration
        });

        if (fcmToken) {
            console.log('[FCM] ✅ Токен успешно получен:', fcmToken.substring(0, 20) + '...');
            // Сохраняем токен в Firebase для отправки уведомлений
            await saveFCMToken(fcmToken, true);
            console.log('[FCM] ✅ Токен сохранен в Firebase. Push-уведомления должны работать.');
            
            // Проверяем количество токенов и предупреждаем о возможном дублировании
            if (calendarId) {
                const calendarRef = db.collection('calendars').doc(calendarId);
                const calendarDoc = await calendarRef.get();
                if (calendarDoc.exists) {
                    const tokens = calendarDoc.data()?.fcmTokens || [];
                    if (tokens.length > 1) {
                        console.warn(`[FCM] ⚠️ ВНИМАНИЕ: Найдено ${tokens.length} токенов в Firebase. Это может вызывать дублирование уведомлений.`);
                        console.warn(`[FCM] 💡 Если у вас одно устройство, рекомендуется оставить только один токен.`);
                        console.warn(`[FCM] 💡 Токены будут автоматически очищены при следующем обновлении.`);
                    }
                }
            }
        } else {
            console.error('[FCM] ❌ Не удалось получить токен. Проверьте конфигурацию Firebase.');
            updateNotificationSystemStatus('failed');
        }

        // Примечание: В compat версии Firebase нет onTokenRefresh
        // Обновление токенов обрабатывается через периодическую проверку (startTokenHealthCheck)
        // и при повторной инициализации FCM

        // Обработка входящих сообщений (когда приложение открыто)
        // ПРИМЕЧАНИЕ: Отключено для предотвращения дублирования уведомлений
        // Push-уведомления уже показываются автоматически системой через firebase-messaging-sw.js
        // Если включить onMessage, будет показываться два уведомления:
        // 1. Системное push-уведомление (правильное, с иконкой)
        // 2. Локальное уведомление от showNotification() (дубликат, с черным квадратом)
        // messaging.onMessage((payload) => {
        //     console.log('[FCM] 📨 Получено push-сообщение:', payload);
        //     showNotification(payload.notification?.body || payload.data?.body || 'Напоминание');
        // });

        // Устанавливаем статус системы как работающей
        updateNotificationSystemStatus('working');
        
        // Запускаем периодическую проверку токена (каждые 24 часа)
        startTokenHealthCheck();

    } catch (error) {
        console.error('[FCM] ❌ Ошибка инициализации:', error);
        console.error('[FCM] Детали ошибки:', error.message, error.stack);
    }
}

// Сохранение FCM токена в Firebase с механизмом повторных попыток и поддержкой офлайн-режима
async function saveFCMToken(token, isInitialAttempt = false) {
    if (!calendarId) {
        console.warn('[FCM] ⚠️ calendarId не установлен, токен не сохранен. Дождитесь инициализации календаря.');
        // Попробуем сохранить позже, когда calendarId будет установлен
        scheduleTokenSaveRetry(token, 2000);
        return false;
    }
    
    try {
        console.log(`[FCM] Сохранение токена в календарь: ${calendarId}`);
        const calendarRef = db.collection('calendars').doc(calendarId);
        
        // Проверяем подключение к сети
        const isOnline = navigator.onLine;
        if (!isOnline) {
            console.warn('[FCM] ⚠️ Устройство офлайн, токен будет сохранен при восстановлении подключения');
            // Сохраняем токен в localStorage для последующего сохранения
            localStorage.setItem('pendingFCMToken', token);
            updateNotificationSystemStatus('degraded');
            return false;
        }
        
        // Получаем текущие токены с обработкой офлайн-режима
        let calendarDoc;
        try {
            calendarDoc = await calendarRef.get({ source: 'server' }); // Пытаемся получить с сервера
        } catch (serverError) {
            // Если не удалось получить с сервера, пробуем из кэша
            console.warn('[FCM] ⚠️ Не удалось получить данные с сервера, используем кэш');
            calendarDoc = await calendarRef.get({ source: 'cache' });
        }
        
        if (!calendarDoc.exists) {
            console.error('[FCM] ❌ Календарь не найден в Firebase:', calendarId);
            updateNotificationSystemStatus('failed');
            return false;
        }
        
        const currentTokens = calendarDoc.data()?.fcmTokens || [];
        console.log(`[FCM] Текущие токены в Firebase: ${currentTokens.length}`);
        
        // Проверяем, установлено ли приложение как PWA
        const isPWA = isPWAInstalled();
        console.log(`[FCM] Режим: ${isPWA ? 'PWA (установленное приложение)' : 'Браузер (веб-сайт)'}`);
        
        // Получаем старый токен этого устройства из localStorage
        const oldToken = localStorage.getItem('fcmToken');
        
        // Удаляем только старый токен этого устройства (если он изменился)
        // Сохраняем все остальные токены для поддержки множественных устройств и пользователей
        let updatedTokens = currentTokens.filter(t => t !== oldToken && t !== token);
            
            // Добавляем новый токен (если его еще нет)
            if (!updatedTokens.includes(token)) {
                updatedTokens.push(token);
            console.log(`[FCM] Новый токен добавлен в список (${isPWA ? 'PWA' : 'браузер'})`);
            } else {
            console.log('[FCM] Токен уже существует в списке');
        }
        
        // Ограничиваем количество токенов (максимум 10 для поддержки множественных устройств и пользователей)
        // Это позволяет хранить токены для: веб + PWA у хозяина, веб + PWA у нижней, + запас
        const maxTokens = 10;
        if (updatedTokens.length > maxTokens) {
            // Оставляем последние N токенов (самые свежие)
            updatedTokens = updatedTokens.slice(-maxTokens);
            console.log(`[FCM] Ограничение: оставлено только последние ${maxTokens} токенов`);
        }
        
        // Логируем для диагностики
        if (updatedTokens.length > 1) {
            console.log(`[FCM] ✅ Найдено ${updatedTokens.length} токенов (поддержка множественных устройств)`);
        }
        
        // Сохраняем обновленный массив токенов
        // Используем update, который работает в офлайн-режиме благодаря persistence
        await calendarRef.update({
            fcmTokens: updatedTokens,
            lastTokenUpdate: firebase.firestore.FieldValue.serverTimestamp()
        });
        
        // Пытаемся дождаться синхронизации (не блокируем, если офлайн)
        try {
            // waitForPendingWrites может быть недоступен в compat версии
            if (db.waitForPendingWrites) {
                await Promise.race([
                    db.waitForPendingWrites(),
                    new Promise((resolve) => setTimeout(resolve, 2000)) // Таймаут 2 секунды
                ]);
                console.log('[FCM] ✅ Данные синхронизированы с сервером (или сохранены локально)');
            }
        } catch (waitError) {
            // Игнорируем ошибки ожидания - данные все равно сохранены локально
            console.log('[FCM] ⚠️ Ожидание синхронизации прервано (данные сохранены локально)');
        }
        
        // Сохраняем новый токен в localStorage для следующего обновления
        localStorage.setItem('fcmToken', token);
        localStorage.removeItem('pendingFCMToken'); // Удаляем отложенный токен, если был
        
        // Сбрасываем счетчик повторных попыток при успехе
        tokenSaveRetryCount = 0;
        if (tokenSaveRetryTimeout) {
            clearTimeout(tokenSaveRetryTimeout);
            tokenSaveRetryTimeout = null;
        }
        
        console.log(`[FCM] ✅ Токен успешно сохранен в Firebase для календаря: ${calendarId} (всего токенов: ${updatedTokens.length})`);
        console.log('[FCM] 💡 Убедитесь, что Firebase Cloud Function "checkAndSendReminders" развернута для отправки push-уведомлений');
        
        updateNotificationSystemStatus('working');
        return true;
    } catch (error) {
        console.error('[FCM] ❌ Ошибка сохранения токена:', error);
        console.error('[FCM] Детали ошибки:', error.message);
        
        // Проверяем, является ли ошибка связанной с офлайн-режимом
        const isOfflineError = error.code === 'unavailable' || 
                               error.message.includes('offline') || 
                               error.message.includes('Failed to get document because the client is offline');
        
        if (isOfflineError) {
            console.warn('[FCM] ⚠️ Клиент в офлайн-режиме. Токен будет сохранен при восстановлении подключения.');
            // Сохраняем токен в localStorage для последующего сохранения
            localStorage.setItem('pendingFCMToken', token);
            // Планируем повторную попытку с большей задержкой
            const delay = Math.min(5000 * Math.pow(2, tokenSaveRetryCount), 60000); // Максимум 60 секунд для офлайн
            console.log(`[FCM] 🔄 Повторная попытка сохранения токена через ${delay}ms (ожидание подключения, попытка ${tokenSaveRetryCount + 1}/5)`);
            scheduleTokenSaveRetry(token, delay);
            updateNotificationSystemStatus('degraded');
        } else {
            // Для других ошибок используем стандартную логику повторных попыток
            if (isInitialAttempt || tokenSaveRetryCount < 5) {
                const delay = Math.min(2000 * Math.pow(2, tokenSaveRetryCount), 30000); // Максимум 30 секунд
                console.log(`[FCM] 🔄 Повторная попытка сохранения токена через ${delay}ms (попытка ${tokenSaveRetryCount + 1}/5)`);
                scheduleTokenSaveRetry(token, delay);
                updateNotificationSystemStatus('degraded');
            } else {
                console.error('[FCM] ❌ Превышено максимальное количество попыток сохранения токена');
                updateNotificationSystemStatus('failed');
            }
        }
        return false;
    }
}

// Планирование повторной попытки сохранения токена
function scheduleTokenSaveRetry(token, delay) {
    if (tokenSaveRetryTimeout) {
        clearTimeout(tokenSaveRetryTimeout);
    }
    tokenSaveRetryTimeout = setTimeout(async () => {
        tokenSaveRetryCount++;
        await saveFCMToken(token, false);
    }, delay);
}

// Периодическая проверка валидности токена
function startTokenHealthCheck() {
    // Проверяем токен каждые 24 часа
    setInterval(async () => {
        if (!messaging || !calendarId) return;
        
        try {
            console.log('[FCM] 🔍 Периодическая проверка токена...');
            const registration = serviceWorkerRegistration || await navigator.serviceWorker.ready;
            const currentToken = await messaging.getToken({
                serviceWorkerRegistration: registration
            });
            
            if (currentToken && currentToken !== fcmToken) {
                console.log('[FCM] 🔄 Обнаружено изменение токена, обновляем...');
                fcmToken = currentToken;
                await saveFCMToken(currentToken, true);
            } else if (currentToken === fcmToken) {
                console.log('[FCM] ✅ Токен валиден');
                updateNotificationSystemStatus('working');
            } else {
                console.warn('[FCM] ⚠️ Не удалось получить токен при проверке');
                updateNotificationSystemStatus('degraded');
            }
            
            lastTokenCheckTime = new Date();
        } catch (error) {
            console.error('[FCM] ❌ Ошибка проверки токена:', error);
            updateNotificationSystemStatus('degraded');
        }
    }, 24 * 60 * 60 * 1000); // 24 часа
}

// Обновление статуса системы уведомлений
function updateNotificationSystemStatus(status) {
    const previousStatus = notificationSystemStatus;
    notificationSystemStatus = status;
    
    const statusMessages = {
        'working': '✅ Система уведомлений работает',
        'degraded': '⚠️ Система уведомлений работает с ограничениями',
        'failed': '❌ Система уведомлений не работает',
        'unknown': '❓ Статус системы уведомлений неизвестен'
    };
    console.log(`[FCM Status] ${statusMessages[status]}`);
    
    // Показываем уведомление пользователю только при ухудшении статуса
    if (previousStatus === 'working' && (status === 'degraded' || status === 'failed')) {
        showSystemStatusNotification(status);
    }
    
    // Обновляем визуальный индикатор (если есть)
    updateStatusIndicator(status);
}

// Показ уведомления о статусе системы
function showSystemStatusNotification(status) {
    if (status === 'failed') {
        console.warn('[FCM] ⚠️ Система уведомлений не работает. Используется локальная проверка как fallback.');
        // Можно показать toast-уведомление пользователю
        if ('Notification' in window && Notification.permission === 'granted') {
            // Показываем только один раз, чтобы не спамить
            const lastStatusNotification = localStorage.getItem('lastStatusNotification');
            const now = Date.now();
            if (!lastStatusNotification || (now - parseInt(lastStatusNotification)) > 3600000) { // Раз в час
                showNotification(
                    'Система push-уведомлений временно недоступна. Используется локальная проверка напоминаний.',
                    '⚠️ Уведомления'
                );
                localStorage.setItem('lastStatusNotification', now.toString());
            }
        }
    }
}

// Обновление визуального индикатора статуса (можно добавить в UI)
function updateStatusIndicator(status) {
    // Можно добавить визуальный индикатор в интерфейс
    // Например, цветной badge или иконку в углу экрана
    // Пока просто логируем
    const statusColors = {
        'working': 'green',
        'degraded': 'yellow',
        'failed': 'red',
        'unknown': 'gray'
    };
    console.log(`[FCM Status Indicator] Цвет: ${statusColors[status]}`);
}

// Умная проверка напоминаний (работает как fallback)
let reminderCheckInterval = null;
function startSmartReminderCheck() {
    // Очищаем предыдущий интервал, если есть
    if (reminderCheckInterval) {
        clearInterval(reminderCheckInterval);
    }
    
    // Запускаем проверку каждую минуту
    // Функция checkReminders сама определит, нужно ли использовать fallback
    reminderCheckInterval = setInterval(() => {
        checkReminders();
    }, 60000); // Каждую минуту
    
    console.log('[Reminders] ✅ Умная проверка напоминаний запущена (fallback активен)');
}

// Переключение мобильного меню
function toggleMobileMenu() {
    // Работает только на мобильных устройствах
    if (window.innerWidth > 768) {
        return;
    }
    
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('mobile-menu-overlay');
    
    if (sidebar && overlay) {
        const isOpen = !sidebar.classList.contains('hidden');
        
        if (isOpen) {
            // Закрываем меню
            sidebar.classList.add('hidden');
            sidebar.classList.remove('block', 'fixed', 'left-0', 'top-0', 'h-full', 'z-50');
            sidebar.style.backgroundColor = 'transparent';
            overlay.classList.add('hidden');
        } else {
            // Открываем меню
            sidebar.classList.remove('hidden');
            sidebar.classList.add('block', 'fixed', 'left-0', 'top-0', 'h-full', 'z-50');
            // Для мобильной версии делаем фон непрозрачным
            sidebar.style.backgroundColor = 'var(--md-surface)';
            overlay.classList.remove('hidden');
        }
    }
}

// Показ информации о календаре
function showCalendarInfo() {
    const infoDiv = document.getElementById('calendar-info');
    const idDisplay = document.getElementById('calendar-id-display');
    
    if (infoDiv && idDisplay) {
        infoDiv.classList.remove('hidden');
        infoDiv.classList.add('flex');
        idDisplay.textContent = calendarId;
    }
}

// Поделиться календарем (копирование ссылки)
function shareCalendar() {
    const url = window.location.href;
    
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(() => {
            alert('Ссылка скопирована в буфер обмена!\n\nПоделитесь этой ссылкой, чтобы другие могли видеть и редактировать календарь.');
        }).catch(() => {
            fallbackCopyTextToClipboard(url);
        });
    } else {
        fallbackCopyTextToClipboard(url);
    }
}

// Запасной способ копирования
function fallbackCopyTextToClipboard(text) {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    
    try {
        document.execCommand('copy');
        alert('Ссылка скопирована в буфер обмена!\n\nПоделитесь этой ссылкой, чтобы другие могли видеть и редактировать календарь.');
    } catch (err) {
        alert('Не удалось скопировать ссылку. Скопируйте вручную:\n\n' + text);
    }
    
    document.body.removeChild(textArea);
}

// Загрузка данных из Firebase
async function loadDataFromFirebase() {
    try {
        // Сначала пытаемся загрузить из локального кэша для быстрого отображения
        loadDataFromCache();
        renderAll();
        
        // Подписываемся на изменения в Firestore (синхронизация в реальном времени)
        const calendarRef = db.collection('calendars').doc(calendarId);
        
        unsubscribeFirestore = calendarRef.onSnapshot(
            {
                includeMetadataChanges: true // Позволяет различать локальные и серверные изменения
            },
            (doc) => {
                // Проверяем, откуда пришли данные (с сервера или из кэша)
                const isFromCache = doc.metadata.fromCache;
                const hasPendingWrites = doc.metadata.hasPendingWrites;
                
                // Игнорируем локальные изменения (они уже применены)
                if (hasPendingWrites && !isFromCache) {
                    return; // Это наше собственное изменение, не обрабатываем
                }
                
                if (doc.exists) {
                    const data = doc.data();
                    // Принимаем данные с сервера как источник истины
                    // Firestore автоматически синхронизирует изменения между устройствами
                    items = {
                        daily: data.daily || [],
                        master: data.master || [],
                        weekly: data.weekly || [],
                        rules: data.rules || [],
                        bans: data.bans || []
                    };
                    
                    // Сохраняем в кэш
                    saveDataToCache();
                    
                    // Обновляем отображение
                    renderAll();
                    
                    // Тихо логируем, если данные из кэша (офлайн-режим)
                    if (isFromCache) {
                        console.log('[Firestore] Используются данные из локального кэша (офлайн-режим)');
                    }
                } else {
                    // Документ не существует, создаем пустой
                    if (!isFromCache) {
                        saveDataToFirebase();
                    }
                }
            },
            (error) => {
                // Игнорируем ошибки сети (нет интернета) - это нормально, работаем офлайн
                if (error.code !== 'unavailable' && error.code !== 'deadline-exceeded') {
                    console.warn('Ошибка синхронизации с Firebase:', error.message || error);
                }
                // Используем данные из кэша при ошибке
                loadDataFromCache();
                renderAll();
            }
        );
    } catch (error) {
        // Игнорируем ошибки сети (нет интернета) - это нормально, работаем офлайн
        if (error.code !== 'unavailable' && error.code !== 'deadline-exceeded') {
            console.warn('Ошибка подключения к Firebase:', error.message || error);
        }
        // Используем данные из кэша при ошибке
        loadDataFromCache();
        renderAll();
    }
}

// Сохранение данных в Firebase
async function saveDataToFirebase() {
    if (!calendarId || !isInitialized) return;
    
    try {
        const calendarRef = db.collection('calendars').doc(calendarId);
        
        // Убеждаемся, что completedDates всегда сохраняются для ежедневных и еженедельных ритуалов
        const ensureCompletedDates = (items) => {
            return items.map(item => {
                if ((item.completedDates === undefined || item.completedDates === null) && 
                    (item.completedDate || item.completed)) {
                    // Если есть completedDate, но нет completedDates, создаем массив
                    if (item.completedDate) {
                        item.completedDates = [item.completedDate.split('T')[0]]; // Берем только дату
                    } else {
                        item.completedDates = [];
                    }
                }
                return item;
            });
        };
        
        const dataToSave = {
            daily: ensureCompletedDates(items.daily || []),
            master: items.master || [],
            weekly: ensureCompletedDates(items.weekly || []),
            rules: items.rules || [],
            bans: items.bans || [],
            lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
        };
        
        await calendarRef.set(dataToSave, { merge: true });
        
        // Также сохраняем в кэш
        saveDataToCache();
    } catch (error) {
        // Игнорируем ошибки сети (нет интернета) - это нормально, работаем офлайн
        // Данные сохраняются в локальный кэш и синхронизируются при появлении интернета
        if (error.code !== 'unavailable' && error.code !== 'deadline-exceeded') {
            console.warn('Ошибка сохранения в Firebase:', error.message || error);
        }
        // Сохраняем в кэш как запасной вариант
        saveDataToCache();
    }
}

// Загрузка данных из локального кэша
function loadDataFromCache() {
    const cacheKey = `ritualsData_${calendarId}`;
    const saved = localStorage.getItem(cacheKey);
    if (saved) {
        try {
            items = JSON.parse(saved);
        } catch (e) {
            console.error('Ошибка чтения кэша:', e);
        }
    }
}

// Сохранение данных в локальный кэш
function saveDataToCache() {
    const cacheKey = `ritualsData_${calendarId}`;
    try {
        localStorage.setItem(cacheKey, JSON.stringify(items));
    } catch (e) {
        console.error('Ошибка сохранения кэша:', e);
    }
}

// Старая функция loadData (для совместимости, теперь использует кэш)
function loadData() {
    loadDataFromCache();
}

// Старая функция saveData (теперь сохраняет в Firebase и кэш)
function saveData() {
    saveDataToFirebase();
}

// Переключение вкладки (вынесено в отдельную функцию для переиспользования)
function switchTab(tabId) {
    // Обновляем активные классы кнопок
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
        btn.style.color = 'var(--md-primary)';
        btn.style.backgroundColor = 'transparent';
        btn.style.opacity = '1';
        if (btn.dataset.tab === tabId) {
            btn.classList.add('active');
            btn.style.color = 'var(--md-primary)';
            btn.style.backgroundColor = '#EDEDF4';
            btn.style.opacity = '1';
        }
    });
    
    // Обновляем контенты вкладок
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active', 'block');
        content.classList.add('hidden');
        if (content.id === tabId) {
            content.classList.add('active', 'block');
            content.classList.remove('hidden');
        }
    });
    
    currentTab = tabId;
}

// Настройка вкладок
function setupTabs() {
    const tabButtons = document.querySelectorAll('.tab-btn');

    tabButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const tabId = btn.dataset.tab;
            switchTab(tabId);
            
            // Закрываем мобильное меню при выборе вкладки (только на мобильных)
            if (window.innerWidth <= 768) {
                const sidebar = document.getElementById('sidebar');
                const overlay = document.getElementById('mobile-menu-overlay');
                if (sidebar && overlay) {
                    sidebar.classList.add('hidden');
                    sidebar.classList.remove('block', 'fixed', 'left-0', 'top-0', 'h-full', 'z-50');
                    overlay.classList.add('hidden');
                }
            }
        });
    });
}

// Настройка формы
function setupForm() {
    const form = document.getElementById('item-form');
    const reminderCheckbox = document.getElementById('item-reminder');
    const timeGroup = document.getElementById('time-group');
    const dayGroup = document.getElementById('day-group');

    if (!form || !reminderCheckbox) return;

    reminderCheckbox.addEventListener('change', () => {
        if (reminderCheckbox.checked) {
            timeGroup?.classList.remove('hidden');
            timeGroup?.classList.add('flex');
            if (currentTab === 'weekly') {
                dayGroup?.classList.remove('hidden');
                dayGroup?.classList.add('flex');
            }
        } else {
            timeGroup?.classList.add('hidden');
            timeGroup?.classList.remove('flex');
            dayGroup?.classList.add('hidden');
            dayGroup?.classList.remove('flex');
        }
    });

    form.addEventListener('submit', (e) => {
        e.preventDefault();
        saveItem();
    });
}

// Настройка чекбокса напоминания
function setupReminderCheck() {
    const reminderCheckbox = document.getElementById('item-reminder');
    reminderCheckbox.addEventListener('change', () => {
        const timeGroup = document.getElementById('time-group');
        const dayGroup = document.getElementById('day-group');
        if (reminderCheckbox.checked) {
            timeGroup.classList.remove('hidden');
            timeGroup.classList.add('flex');
        } else {
            timeGroup.classList.add('hidden');
            timeGroup.classList.remove('flex');
        }
        if (currentTab === 'weekly') {
            if (reminderCheckbox.checked) {
                dayGroup.classList.remove('hidden');
                dayGroup.classList.add('flex');
            } else {
                dayGroup.classList.add('hidden');
                dayGroup.classList.remove('flex');
            }
        }
    });
}

// Добавление элемента
function addItem(type) {
    if (isMaintenanceMode()) return;
    
    editingItemId = null;
    
    // Переключаемся на нужную вкладку
    switchTab(type);

    // Очищаем форму
    document.getElementById('item-form').reset();
    
    // Для правил и запретов - простая форма
    const isSimpleList = type === 'rules' || type === 'bans';
    const titles = {
        'daily': 'Добавить ежедневный ритуал',
        'master': 'Добавить задачу от Хозяина',
        'weekly': 'Добавить еженедельный ритуал',
        'rules': 'Добавить правило',
        'bans': 'Добавить запрет'
    };
    
    document.getElementById('modal-title').textContent = titles[type] || 'Добавить задачу';
    
    // Скрываем/показываем поля в зависимости от типа
    const reminderGroup = document.getElementById('item-reminder')?.closest('.flex');
    const timeGroup = document.getElementById('time-group');
    const dayGroup = document.getElementById('day-group');
    const colorGroup = document.getElementById('color-group'); // Может быть null, если элемент удален из HTML
    const isActiveGroup = document.getElementById('is-active-group');
    
    if (isSimpleList) {
        reminderGroup?.classList.add('hidden');
        timeGroup?.classList.add('hidden');
        dayGroup?.classList.add('hidden');
        colorGroup?.classList.add('hidden');
        isActiveGroup?.classList.add('hidden');
    } else {
        reminderGroup?.classList.remove('hidden');
        timeGroup?.classList.add('hidden');
        dayGroup?.classList.add('hidden');
        // Поле is_active только для ежедневных ритуалов (цвет убран - используются статичные цвета)
        if (type === 'daily') {
            colorGroup?.classList.add('hidden'); // Всегда скрыто (если элемент существует)
            isActiveGroup?.classList.remove('hidden');
        } else {
            colorGroup?.classList.add('hidden');
            isActiveGroup?.classList.add('hidden');
        }
    }
    
    // Показываем модальное окно
    const modal = document.getElementById('modal');
    if (!modal) {
        console.error('[addItem] Модальное окно не найдено');
        return;
    }
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

// Редактирование элемента
function editItem(type, id) {
    if (isMaintenanceMode()) return;
    
    const item = items[type].find(i => i.id === id);
    if (!item) return;

    editingItemId = id;
    currentTab = type;

    // Заполняем форму
    document.getElementById('item-name').value = item.name;
    document.getElementById('item-description').value = item.description || '';
    
    // Для правил и запретов - простая форма
    const isSimpleList = type === 'rules' || type === 'bans';
    
    const reminderGroup = document.getElementById('item-reminder')?.closest('.flex');
    const timeGroup = document.getElementById('time-group');
    const dayGroup = document.getElementById('day-group');
    const colorGroup = document.getElementById('color-group'); // Может быть null, если элемент удален из HTML
    const isActiveGroup = document.getElementById('is-active-group');
    
    if (isSimpleList) {
        reminderGroup?.classList.add('hidden');
        timeGroup?.classList.add('hidden');
        dayGroup?.classList.add('hidden');
        colorGroup?.classList.add('hidden');
        isActiveGroup?.classList.add('hidden');
    } else {
        reminderGroup?.classList.remove('hidden');
        const reminderCheckbox = document.getElementById('item-reminder');
        if (reminderCheckbox) {
            reminderCheckbox.checked = item.reminder || false;
        }
        
        // Заполняем поля для ежедневных ритуалов
        if (type === 'daily') {
            colorGroup?.classList.add('hidden'); // Всегда скрыто (если элемент существует)
            isActiveGroup?.classList.remove('hidden');
            // Цвет не сохраняется - используются статичные цвета
            const isActiveCheckbox = document.getElementById('item-is-active');
            if (isActiveCheckbox) {
                isActiveCheckbox.checked = item.is_active !== false;
            }
        } else {
            colorGroup?.classList.add('hidden');
            isActiveGroup?.classList.add('hidden');
        }
        
        if (item.reminder) {
            timeGroup?.classList.remove('hidden');
            const timeInput = document.getElementById('item-time');
            if (timeInput && item.time) {
                timeInput.value = item.time;
            }
            if (type === 'weekly' && item.day) {
                dayGroup?.classList.remove('hidden');
                const daySelect = document.getElementById('item-day');
                if (daySelect) {
                    daySelect.value = item.day;
                }
            } else {
                dayGroup?.classList.add('hidden');
            }
        } else {
            timeGroup?.classList.add('hidden');
            dayGroup?.classList.add('hidden');
        }
    }

    const titles = {
        'daily': 'Редактировать ежедневный ритуал',
        'master': 'Редактировать задачу от Хозяина',
        'weekly': 'Редактировать еженедельный ритуал',
        'rules': 'Редактировать правило',
        'bans': 'Редактировать запрет'
    };
    
    const modalTitle = document.getElementById('modal-title');
    if (modalTitle) {
        modalTitle.textContent = titles[type] || 'Редактировать задачу';
    }
    const modal = document.getElementById('modal');
    if (!modal) {
        console.error('[editItem] Модальное окно не найдено');
        return;
    }
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

// Показ полного описания задачи
function showFullDescription(event, description) {
    // Если description передан как строка, декодируем HTML entities
    if (typeof description === 'string') {
        description = description.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
    }
    
    if (!description || !description.trim()) return;
    
    // Останавливаем всплытие события, чтобы не срабатывал клик на контейнере
    if (event) event.stopPropagation();
    
    // Создаем модальное окно для показа полного описания
    const modal = document.createElement('div');
    modal.className = 'fixed z-[1001] inset-0 backdrop-blur-sm items-center justify-center';
    modal.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
    modal.style.display = 'flex';
    
    modal.innerHTML = `
        <div class="p-8 rounded-2xl max-w-lg w-[90%] max-h-[90vh] overflow-y-auto shadow-md-xl relative" style="background-color: var(--md-surface); border: 1px solid var(--md-outline-variant);">
            <button class="absolute right-4 top-4 text-2xl text-md-on-surface-variant hover:text-md-on-surface" onclick="this.closest('.fixed').remove()" style="cursor: pointer;">&times;</button>
            <h3 class="text-xl font-medium mb-4" style="color: var(--md-on-surface);">Полное описание</h3>
            <div class="text-base whitespace-pre-wrap" style="color: var(--md-on-surface); line-height: 1.6;">${escapeHtml(description)}</div>
        </div>
    `;
    
    // Закрытие по клику на фон
    modal.addEventListener('click', function(e) {
        if (e.target === modal) {
            modal.remove();
        }
    });
    
    document.body.appendChild(modal);
}

// Сохранение элемента
function saveItem() {
    if (isMaintenanceMode()) return;
    const name = document.getElementById('item-name').value.trim();
    const description = document.getElementById('item-description').value.trim();
    
    // Для правил и запретов - простой список без напоминаний
    const isSimpleList = currentTab === 'rules' || currentTab === 'bans';
    
    const reminder = isSimpleList ? false : document.getElementById('item-reminder').checked;
    let time = (isSimpleList || !reminder) ? null : document.getElementById('item-time').value;
    
    // Нормализуем время: убеждаемся, что оно в формате HH:MM с ведущими нулями
    if (time) {
        const timeParts = time.split(':');
        if (timeParts.length === 2) {
            const hours = String(parseInt(timeParts[0], 10) || 0).padStart(2, '0');
            const minutes = String(parseInt(timeParts[1], 10) || 0).padStart(2, '0');
            time = `${hours}:${minutes}`;
        }
    }
    const day = (isSimpleList || !reminder || currentTab !== 'weekly') ? null : document.getElementById('item-day').value;

    if (!name) return;

    const baseExisting = editingItemId ? items[currentTab].find(i => i.id === editingItemId) : null;
    const todayDate = getLocalDateString();

    // дата начала для ежедневных ритуалов
    let startDate = baseExisting?.startDate;
    if (currentTab === 'daily' && !startDate) {
        startDate = todayDate;
    }

    // Получаем дополнительные поля для ежедневных ритуалов
    // Цвет не сохраняется - используются статичные цвета для каждого типа (EVENT_COLORS)
    const isActive = (currentTab === 'daily') ? (document.getElementById('item-is-active')?.checked !== false) : undefined;

    const item = {
        id: editingItemId || Date.now().toString(),
        name,
        description: description || '',
        reminder: isSimpleList ? false : reminder,
        time: isSimpleList ? null : time,
        day: isSimpleList ? null : day,
        // Для ежедневных ритуалов добавляем только is_active (цвет убран - используются статичные цвета)
        is_active: currentTab === 'daily' ? isActive : undefined,
        completed: editingItemId ? (baseExisting?.completed || false) : false,
        completedDate: editingItemId ? baseExisting?.completedDate : null,
        // для ежедневных и еженедельных ритуалов всегда сохраняем массив выполненных дат (если он есть)
        completedDates: ((currentTab === 'daily' || currentTab === 'weekly') && baseExisting?.completedDates && baseExisting.completedDates.length > 0) ? baseExisting.completedDates : ((currentTab === 'daily' || currentTab === 'weekly') && baseExisting?.completedDates) ? baseExisting.completedDates : undefined,
        startDate,
        // для задач от Хозяина запоминаем день постановки
        createdDate: currentTab === 'master'
            ? (baseExisting?.createdDate || todayDate)
            : baseExisting?.createdDate
    };

    // Firestore не принимает undefined в полях
    if (item.createdDate === undefined) {
        delete item.createdDate;
    }

    if (item.startDate === undefined) {
        delete item.startDate;
    }
    
    if (item.completedDates === undefined) {
        delete item.completedDates;
    }
    
    if (item.time === null || item.time === undefined) {
        delete item.time;
    }
    
    if (item.day === null || item.day === undefined) {
        delete item.day;
    }
    
    // color больше не сохраняется - используются статичные цвета для каждого типа
    // Удаляем color из старых записей при сохранении
    if (item.color !== undefined) {
        delete item.color;
    }
    
    if (item.is_active === undefined) {
        delete item.is_active;
    }

    if (editingItemId) {
        const index = items[currentTab].findIndex(i => i.id === editingItemId);
        if (index !== -1) {
            items[currentTab][index] = item;
        }
    } else {
        items[currentTab].push(item);
    }

    saveData();
    renderAll();
    
    // Обновляем шкалу прогресса
    updateProgressHeart();
    
    closeModal();
}

// Удаление элемента
function deleteItem(type, id) {
    if (isMaintenanceMode()) return;
    
    if (confirm('Вы уверены, что хотите удалить эту задачу?')) {
        items[type] = items[type].filter(i => i.id !== id);
        saveData();
        renderAll();
    }
}

// Переключение выполнения
function toggleComplete(type, id, dateKey = null) {
    if (isMaintenanceMode()) return;
    
    // Для правил и запретов нет статуса выполнения
    if (type === 'rules' || type === 'bans') return;
    
    const item = items[type].find(i => i.id === id);
    if (!item) return;

    // Определяем дату выполнения
    const today = dateKey || getLocalDateString();
    
    // Для ежедневных и еженедельных ритуалов используем completedDates
    if (type === 'daily' || type === 'weekly') {
        if (!item.completedDates) {
            item.completedDates = [];
        }
        
        const isCompleted = item.completedDates.includes(today);
        
        if (isCompleted) {
            // Убираем из массива выполненных дат
            item.completedDates = item.completedDates.filter(d => d !== today);
            // Для обратной совместимости
            item.completed = false;
            item.completedDate = null;
        } else {
            // Добавляем в массив выполненных дат
            if (!item.completedDates.includes(today)) {
                item.completedDates.push(today);
            }
            // Для обратной совместимости
            item.completed = true;
            item.completedDate = today;
        }
    } else {
        // Для задач от Хозяина используем старую логику
        if (item.completed) {
            item.completed = false;
            item.completedDate = null;
        } else {
            item.completed = true;
            item.completedDate = new Date().toISOString();
        }
    }

    saveData();
    renderAll();
    
    // Обновляем шкалу прогресса
    updateProgressHeart();
    
    // Проверяем, все ли задачи за день выполнены
    checkAllTasksCompleted();
}

// Проверка выполнения всех задач за день
function checkAllTasksCompleted() {
    const today = getLocalDateString();
    const currentDay = getCurrentDayName();
    
    // Проверяем ежедневные ритуалы (только активные)
    const dailyTasks = (items.daily || []).filter(item => item.is_active !== false);
    const allDailyCompleted = dailyTasks.length === 0 || dailyTasks.every(item => {
        // Проверяем массив выполненных дат (новый формат)
        if (item.completedDates && Array.isArray(item.completedDates)) {
            return item.completedDates.includes(today);
        }
        // Проверяем старый формат completedDate
        if (item.completedDate) {
            // completedDate может быть в формате "YYYY-MM-DD" или "YYYY-MM-DDTHH:mm:ss.sssZ"
            const completedDate = item.completedDate.includes('T') 
                ? item.completedDate.split('T')[0] 
                : item.completedDate;
            return completedDate === today;
        }
        // Проверяем флаг completed для обратной совместимости
        return item.completed === true;
    });
    
    // Проверяем задачи от хозяина (только те, которые относятся к сегодняшнему дню)
    const allMasterTasks = items.master || [];
    // Фильтруем только задачи, которые созданы на сегодня или должны быть выполнены сегодня
    const masterTasks = allMasterTasks.filter(item => {
        if (!item.createdDate) return false;
        // Проверяем, что задача создана на сегодняшний день
        const createdDate = item.createdDate.split('T')[0];
        return createdDate === today;
    });
    
    // Проверяем, что все задачи от хозяина на сегодня выполнены
    const allMasterCompleted = masterTasks.length === 0 || masterTasks.every(item => {
        // Проверяем, что задача выполнена и дата выполнения соответствует сегодня
        if (!item.completed) return false;
        if (item.completedDate) {
            const completedDate = item.completedDate.split('T')[0];
            return completedDate === today;
        }
        // Если completedDate нет, но completed === true, считаем выполненной (для обратной совместимости)
        return item.completed === true;
    });
    
    // Проверяем еженедельные ритуалы (только для текущего дня недели)
    const weeklyTasks = (items.weekly || []).filter(item => item.day === currentDay);
    const allWeeklyCompleted = weeklyTasks.length === 0 || weeklyTasks.every(item => {
        if (item.completedDates && Array.isArray(item.completedDates)) {
            return item.completedDates.includes(today);
        }
        return item.completed === true;
    });
    
    // Логирование для диагностики
    const shouldShow = allDailyCompleted && allMasterCompleted && allWeeklyCompleted && 
                      (dailyTasks.length > 0 || masterTasks.length > 0 || weeklyTasks.length > 0);
    
    console.log('[Congratulations] Проверка выполнения задач:', {
        today,
        currentDay,
        dailyTasks: {
            count: dailyTasks.length,
            allCompleted: allDailyCompleted,
            items: dailyTasks.map(t => ({ id: t.id, name: t.name, completed: t.completed, completedDate: t.completedDate, completedDates: t.completedDates }))
        },
        masterTasks: {
            count: masterTasks.length,
            allCompleted: allMasterCompleted,
            items: masterTasks.map(t => ({ 
                id: t.id, 
                name: t.name, 
                completed: t.completed, 
                createdDate: t.createdDate,
                completedDate: t.completedDate 
            }))
        },
        weeklyTasks: {
            count: weeklyTasks.length,
            allCompleted: allWeeklyCompleted,
            items: weeklyTasks.map(t => ({ id: t.id, name: t.name, completed: t.completed, completedDates: t.completedDates, day: t.day }))
        },
        shouldShow
    });
    
    // Если все задачи выполнены и есть хотя бы одна задача, показываем поздравление
    if (shouldShow) {
        console.log('[Congratulations] ✅ Все задачи выполнены! Показываем поздравление...');
        showCongratulations();
    } else {
        console.log('[Congratulations] ❌ Условия не выполнены. Причины:', {
            allDailyCompleted,
            allMasterCompleted,
            allWeeklyCompleted,
            hasTasks: (dailyTasks.length > 0 || masterTasks.length > 0 || weeklyTasks.length > 0)
        });
    }
}

// Расчет и обновление шкалы прогресса в виде сердца
function updateProgressHeart(targetDate = null) {
    // Если дата не указана, используем текущую дату или дату из календаря
    let targetDateObj;
    if (targetDate) {
        targetDateObj = new Date(targetDate);
    } else if (calendar && calendar.view && calendar.view.type === 'dayGridDay') {
        // Если календарь в режиме дня, используем текущую дату календаря
        targetDateObj = calendar.view.currentStart;
    } else {
        // По умолчанию используем сегодня
        targetDateObj = new Date();
    }
    
    const targetDateString = getLocalDateString(targetDateObj);
    const targetDay = getDayNameFromDate(targetDateObj);
    
    // Проверяем, в каком режиме календарь
    const isDayView = calendar && calendar.view && calendar.view.type === 'dayGridDay';
    
    // Показываем/скрываем сердце в зависимости от режима
    const heartContainer = document.getElementById('progress-heart-container');
    if (heartContainer) {
        if (isDayView) {
            heartContainer.style.display = 'flex';
        } else {
            heartContainer.style.display = 'none';
            return; // Не обновляем, если не в режиме дня
        }
    }
    
    const today = targetDateString;
    const currentDay = targetDay;
    
    // Подсчитываем все задачи на сегодня
    const dailyTasks = (items.daily || []).filter(item => item.is_active !== false);
    const allMasterTasks = items.master || [];
    const masterTasks = allMasterTasks.filter(item => {
        if (!item.createdDate) return false;
        const createdDate = item.createdDate.split('T')[0];
        return createdDate === today;
    });
    const weeklyTasks = (items.weekly || []).filter(item => item.day === currentDay);
    
    const totalTasks = dailyTasks.length + masterTasks.length + weeklyTasks.length;
    
    if (totalTasks === 0) {
        // Если нет задач, показываем пустое сердце
        setHeartProgress(0);
        return;
    }
    
    // Подсчитываем выполненные задачи
    let completedCount = 0;
    
    // Ежедневные ритуалы
    dailyTasks.forEach(item => {
        if (item.completedDates && Array.isArray(item.completedDates)) {
            if (item.completedDates.includes(today)) completedCount++;
        } else if (item.completedDate) {
            const completedDate = item.completedDate.includes('T') 
                ? item.completedDate.split('T')[0] 
                : item.completedDate;
            if (completedDate === today) completedCount++;
        } else if (item.completed === true) {
            completedCount++;
        }
    });
    
    // Задачи от хозяина
    masterTasks.forEach(item => {
        if (item.completed) {
            if (item.completedDate) {
                const completedDate = item.completedDate.split('T')[0];
                if (completedDate === today) completedCount++;
            } else {
                completedCount++;
            }
        }
    });
    
    // Еженедельные ритуалы
    weeklyTasks.forEach(item => {
        if (item.completedDates && Array.isArray(item.completedDates)) {
            if (item.completedDates.includes(today)) completedCount++;
        } else if (item.completed === true) {
            completedCount++;
        }
    });
    
    // Вычисляем процент
    const percent = totalTasks > 0 ? Math.round((completedCount / totalTasks) * 100) : 0;
    
    // Обновляем визуализацию
    setHeartProgress(percent);
}

// Установка прогресса сердца с анимацией
function setHeartProgress(percent) {
    const fillRect = document.getElementById('heart-fill-rect');
    const heartSvg = document.getElementById('progress-heart');
    const heartFilled = document.getElementById('heart-filled');
    const heartShine = document.getElementById('heart-shine');
    
    if (!fillRect || !heartSvg) return;
    
    // Вычисляем высоту заполнения (от 0 до 24, снизу вверх)
    const fillHeight = (percent / 100) * 24;
    const fillY = 24 - fillHeight;
    
    // Плавная анимация заполнения через CSS transition
    fillRect.setAttribute('y', fillY.toString());
    fillRect.setAttribute('height', fillHeight.toString());
    
    // Добавляем эффект свечения при заполнении
    if (percent > 0) {
        heartSvg.classList.add('heart-active');
        if (heartFilled) {
            heartFilled.style.opacity = '1';
        }
        if (heartShine) {
            heartShine.style.opacity = Math.min(0.4, percent / 100 * 0.4);
        }
    } else {
        heartSvg.classList.remove('heart-active');
        if (heartFilled) {
            heartFilled.style.opacity = '0';
        }
        if (heartShine) {
            heartShine.style.opacity = '0';
        }
    }
    
    // Красивая анимация пульсации при изменении
    if (percent > 0 && percent < 100) {
        heartSvg.style.animation = 'heartPulseSmooth 0.8s cubic-bezier(0.4, 0, 0.2, 1)';
        setTimeout(() => {
            heartSvg.style.animation = '';
        }, 800);
    } else if (percent === 100) {
        // Специальная анимация при 100% с эффектом свечения
        heartSvg.style.animation = 'heartCompleteSmooth 1.2s cubic-bezier(0.4, 0, 0.2, 1)';
        if (heartFilled) {
            heartFilled.style.animation = 'heartGlow 1.5s ease-in-out infinite';
        }
        setTimeout(() => {
            heartSvg.style.animation = '';
        }, 1200);
    }
}

// Показ поздравления с анимацией салюта
function showCongratulations() {
    console.log('[Congratulations] showCongratulations() вызвана');
    
    // Проверяем, не показывали ли уже сегодня поздравление
    const lastCongratsDate = localStorage.getItem('lastCongratulationsDate');
    const today = getLocalDateString();
    
    console.log('[Congratulations] Проверка даты:', {
        lastCongratsDate,
        today,
        alreadyShown: lastCongratsDate === today
    });
    
    if (lastCongratsDate === today) {
        console.log('[Congratulations] ⚠️ Поздравление уже показывалось сегодня, пропускаем');
        return; // Уже показывали сегодня
    }
    
    // Сохраняем дату показа
    localStorage.setItem('lastCongratulationsDate', today);
    console.log('[Congratulations] Сохранили дату показа:', today);
    
    // Запускаем анимацию салюта
    console.log('[Congratulations] Запускаем анимацию салюта...');
    launchConfetti();
    
    // Показываем overlay с поздравлением
    console.log('[Congratulations] Показываем overlay...');
    showCongratulationsOverlay();
}

// Запуск анимации салюта
function launchConfetti() {
    if (typeof confetti === 'undefined') {
        console.warn('[Confetti] Библиотека confetti не загружена');
        return;
    }
    
    // Настройки для красивого салюта
    const duration = 3000;
    const end = Date.now() + duration;
    
    const colors = ['#FFD700', '#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8'];
    
    (function frame() {
        confetti({
            particleCount: 3,
            angle: 60,
            spread: 55,
            origin: { x: 0 },
            colors: colors
        });
        
        confetti({
            particleCount: 3,
            angle: 120,
            spread: 55,
            origin: { x: 1 },
            colors: colors
        });
        
        if (Date.now() < end) {
            requestAnimationFrame(frame);
        }
    }());
    
    // Дополнительный взрыв в центре
    setTimeout(() => {
        confetti({
            particleCount: 100,
            spread: 70,
            origin: { y: 0.6 },
            colors: colors
        });
    }, 500);
}

// Показ overlay с поздравлением
function showCongratulationsOverlay() {
    console.log('[Congratulations] showCongratulationsOverlay() вызвана');
    
    const messages = [
        "Идеальное исполнение. Прими мои поздравления, хорошая девочка. Я горжусь тобой!",
        "План выполнен. Я ценю твою дисциплину — сегодня ты служила образцово.",
        "Систематичность и результат. Этот день послужил на благо нашей динамики, моя преданная.",
        "Идеальное исполнение. Прими мои поздравления, хорошая девочка. Я горжусь тобой.",
        "Цель достигнута. Твой Хозяин будет доволен."
    ];
    
    // Выбираем случайное сообщение
    const randomMessage = messages[Math.floor(Math.random() * messages.length)];
    console.log('[Congratulations] Выбрано сообщение:', randomMessage);
    
    // Создаем overlay, если его еще нет
    let overlay = document.getElementById('congratulations-overlay');
    if (!overlay) {
        console.log('[Congratulations] Создаем новый overlay...');
        overlay = document.createElement('div');
        overlay.id = 'congratulations-overlay';
        overlay.className = 'fixed inset-0 z-[2000] flex items-center justify-center';
        overlay.style.cssText = 'background-color: rgba(0, 0, 0, 0.7); backdrop-filter: blur(4px);';
        overlay.innerHTML = `
            <div class="congratulations-content max-w-md w-[90%] p-8 rounded-2xl text-center relative" style="background-color: var(--md-surface); border: 2px solid var(--md-primary); box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.3);">
                <button class="absolute right-4 top-4 text-2xl font-normal cursor-pointer transition-colors" onclick="closeCongratulations()" style="color: var(--md-on-surface-variant);" onmouseover="this.style.color='var(--md-on-surface)';" onmouseout="this.style.color='var(--md-on-surface-variant)';">&times;</button>
                <div class="text-6xl mb-4">🎉</div>
                <h2 class="text-2xl font-normal mb-4" style="color: var(--md-primary); font-family: 'Gabriela', serif;">Поздравляю!</h2>
                <p class="text-lg mb-6" style="color: var(--md-on-surface);" id="congratulations-message"></p>
                <button class="btn-primary px-8 py-3 rounded-lg" onclick="closeCongratulations()" style="background-color: var(--md-primary); color: var(--md-on-primary);">Понятно</button>
            </div>
        `;
        document.body.appendChild(overlay);
        console.log('[Congratulations] Overlay добавлен в DOM');
    } else {
        console.log('[Congratulations] Overlay уже существует, используем существующий');
    }
    
    // Устанавливаем сообщение
    const messageEl = overlay.querySelector('#congratulations-message');
    if (messageEl) {
        messageEl.textContent = randomMessage;
        console.log('[Congratulations] Сообщение установлено в элемент');
    } else {
        console.error('[Congratulations] ❌ Элемент #congratulations-message не найден!');
    }
    
    // Показываем overlay с анимацией
    console.log('[Congratulations] Показываем overlay...');
    overlay.style.display = 'flex';
    overlay.style.opacity = '0';
    setTimeout(() => {
        overlay.style.transition = 'opacity 0.3s ease-in-out';
        overlay.style.opacity = '1';
        console.log('[Congratulations] Overlay должен быть виден теперь');
    }, 10);
}

// Закрытие поздравления
function closeCongratulations() {
    const overlay = document.getElementById('congratulations-overlay');
    if (overlay) {
        overlay.style.transition = 'opacity 0.3s ease-in-out';
        overlay.style.opacity = '0';
        setTimeout(() => {
            overlay.style.display = 'none';
        }, 300);
    }
}

// Отрисовка всех списков
function renderAll() {
    renderList('daily');
    renderList('master');
    renderList('weekly');
    renderList('rules');
    renderList('bans');
    updateCalendarEvents();
}

// Инициализация FullCalendar
function initFullCalendar() {
    const calendarEl = document.getElementById('fullcalendar');
    if (!calendarEl || typeof FullCalendar === 'undefined') return;

    calendar = new FullCalendar.Calendar(calendarEl, {
        initialView: 'dayGridDay',
        locale: 'ru',
        firstDay: 1,
        
        // Обработчик изменения даты/view
        datesSet: function(dateInfo) {
            // Обновляем шкалу прогресса при изменении даты или view
            updateProgressHeart();
        },
        height: 'auto',
        contentHeight: 'auto',
        headerToolbar: {
            left: 'dayGridDay,dayGridWeek',
            center: '',
            right: 'prev,today,next'
        },
        buttonText: {
            today: 'Сегодня'
        },
        views: {
            dayGridDay: {
                titleFormat: function(arg) {
                    // Формат для режима дня: "25 декабря четверг"
                    const months = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 
                                   'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
                    const days = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
                    
                    // FullCalendar передает объект с полями start и end
                    let date;
                    if (arg && arg.start) {
                        date = arg.start;
                    } else if (arg && arg.end) {
                        date = arg.end;
                    } else if (arg instanceof Date) {
                        date = arg;
                    } else {
                        // Если ничего не подошло, используем текущую дату
                        date = new Date();
                    }
                    
                    // Убеждаемся, что date - это объект Date
                    if (!(date instanceof Date)) {
                        date = new Date(date);
                    }
                    
                    const day = date.getDate();
                    const month = months[date.getMonth()];
                    const dayOfWeek = days[date.getDay()];
                    
                    const result = `${day} ${month} ${dayOfWeek}`;
                    console.log('[Calendar] titleFormat:', { arg, date, result });
                    return result;
                },
                buttonText: 'День'
            },
            dayGridWeek: {
                titleFormat: { year: 'numeric', month: 'long' },
                buttonText: 'Неделя'
            }
        },
        dayMaxEvents: false,
        editable: false,
        selectable: false,
        eventClick: function(info) {
            info.jsEvent.preventDefault();
            info.jsEvent.stopPropagation();
            handleCalendarEventClick(info);
        },
        eventContent: function(info) {
            // Кастомное форматирование времени с сохранением ведущих нулей
            const timeText = info.timeText;
            if (timeText && info.event.start) {
                // Получаем время из события
                const eventStart = info.event.start;
                if (eventStart instanceof Date) {
                    const hours = String(eventStart.getHours()).padStart(2, '0');
                    const minutes = String(eventStart.getMinutes()).padStart(2, '0');
                    const formattedTime = `${hours}:${minutes}`;
                    
                    // Если время не совпадает с отформатированным (потеряны нули), заменяем
                    if (timeText !== formattedTime && timeText.match(/\d+:\d+/)) {
                        // Создаем кастомный элемент с правильным временем
                        const timeEl = document.createElement('time');
                        timeEl.textContent = formattedTime;
                        timeEl.className = 'fc-event-time';
                        
                        const titleEl = document.createElement('div');
                        titleEl.className = 'fc-event-title';
                        titleEl.textContent = info.event.title;
                        
                        const fragment = document.createDocumentFragment();
                        fragment.appendChild(timeEl);
                        fragment.appendChild(titleEl);
                        
                        return { domNodes: [fragment] };
                    }
                }
            }
            
            // Возвращаем стандартное содержимое, если не нужно кастомизировать
            return { html: info.timeText + ' ' + info.event.title };
        },
        eventDidMount: function(info) {
            // Добавляем title для tooltip при наведении
            const fullTitle = info.event.extendedProps.fullTitle || info.event.title;
            if (info.el) {
                info.el.setAttribute('title', fullTitle);
                
                // Исправляем отображение времени с ведущими нулями
                const timeEl = info.el.querySelector('.fc-event-time');
                if (timeEl && info.event.start) {
                    const eventStart = info.event.start;
                    if (eventStart instanceof Date) {
                        const hours = String(eventStart.getHours()).padStart(2, '0');
                        const minutes = String(eventStart.getMinutes()).padStart(2, '0');
                        const formattedTime = `${hours}:${minutes}`;
                        timeEl.textContent = formattedTime;
                    }
                }
                
                // Принудительно применяем цвета из события (важно для онлайн-режима)
                if (info.event.backgroundColor) {
                    info.el.style.setProperty('background-color', info.event.backgroundColor, 'important');
                }
                if (info.event.borderColor) {
                    info.el.style.setProperty('border-color', info.event.borderColor, 'important');
                }
                if (info.event.textColor) {
                    info.el.style.setProperty('color', info.event.textColor, 'important');
                }
                
                // Также применяем к дочерним элементам (для текста внутри события)
                const eventText = info.el.querySelector('.fc-event-title');
                if (eventText && info.event.textColor) {
                    eventText.style.setProperty('color', info.event.textColor, 'important');
                }
                
                // Добавляем зачеркивание для выполненных событий
                if (info.event.extendedProps.isCompleted || info.event.classNames.includes('fc-event-completed')) {
                    if (eventText) {
                        eventText.style.setProperty('text-decoration', 'line-through', 'important');
                    }
                    // Также зачеркиваем весь элемент события
                    info.el.style.setProperty('text-decoration', 'line-through', 'important');
                }
            }
        }
    });

    calendar.render();
    
    // Применяем стили для кнопок навигации после рендера
    setTimeout(() => {
        applyNavigationButtonStyles();
    }, 100);
    updateCalendarEvents();
}

// Применение стилей для кнопок навигации
function applyNavigationButtonStyles() {
    // Ищем кнопки разными способами (FullCalendar может использовать разные классы)
    const prevButtons = document.querySelectorAll('.fc-button-prev, .fc-prev-button, button[aria-label*="prev"], button[aria-label*="Предыдущий"]');
    const nextButtons = document.querySelectorAll('.fc-button-next, .fc-next-button, button[aria-label*="next"], button[aria-label*="Следующий"]');
    const todayButtons = document.querySelectorAll('.fc-today-button, button[aria-label*="today"], button[aria-label*="Сегодня"]');
    
    // Также ищем через структуру toolbar
    const toolbarChunk = document.querySelector('.fc-toolbar-chunk:last-child');
    if (toolbarChunk) {
        const allButtons = toolbarChunk.querySelectorAll('button');
        allButtons.forEach((button, index) => {
            const buttonText = button.textContent || button.innerText || '';
            const ariaLabel = button.getAttribute('aria-label') || '';
            const classList = Array.from(button.classList);
            
            // Определяем тип кнопки по содержимому или классам
            if (buttonText.includes('Сегодня') || ariaLabel.includes('today') || ariaLabel.includes('Сегодня') || classList.some(c => c.includes('today'))) {
                // Кнопка "Сегодня"
                applyButtonStyles(button, 'today');
            } else if (buttonText.includes('<') || ariaLabel.includes('prev') || ariaLabel.includes('Предыдущий') || classList.some(c => c.includes('prev'))) {
                // Кнопка "<"
                applyButtonStyles(button, 'prev');
            } else if (buttonText.includes('>') || ariaLabel.includes('next') || ariaLabel.includes('Следующий') || classList.some(c => c.includes('next'))) {
                // Кнопка ">"
                applyButtonStyles(button, 'next');
            }
        });
    }
    
    // Применяем стили ко всем найденным кнопкам через селекторы
    prevButtons.forEach(button => applyButtonStyles(button, 'prev'));
    nextButtons.forEach(button => applyButtonStyles(button, 'next'));
    todayButtons.forEach(button => applyButtonStyles(button, 'today'));
    
    console.log('[Calendar] Стили применены к кнопкам:', {
        prev: prevButtons.length,
        next: nextButtons.length,
        today: todayButtons.length,
        toolbarButtons: toolbarChunk ? toolbarChunk.querySelectorAll('button').length : 0
    });
}

// Вспомогательная функция для применения стилей к кнопке
function applyButtonStyles(button, type) {
    if (!button) return;
    
    // Закругление на всех 4 углах
    button.style.setProperty('border-radius', '8px', 'important');
    button.style.setProperty('border-top-left-radius', '8px', 'important');
    button.style.setProperty('border-top-right-radius', '8px', 'important');
    button.style.setProperty('border-bottom-left-radius', '8px', 'important');
    button.style.setProperty('border-bottom-right-radius', '8px', 'important');
    
    // Отступы в зависимости от типа кнопки
    if (type === 'prev') {
        button.style.setProperty('margin-right', '1px', 'important');
        button.style.setProperty('margin-left', '0', 'important');
    } else if (type === 'next') {
        button.style.setProperty('margin-left', '1px', 'important');
        button.style.setProperty('margin-right', '0', 'important');
    } else if (type === 'today') {
        button.style.setProperty('margin-left', '1px', 'important');
        button.style.setProperty('margin-right', '1px', 'important');
    }
    
    button.style.setProperty('margin-top', '0', 'important');
    button.style.setProperty('margin-bottom', '0', 'important');
}

// Обработка клика на событие в календаре
function handleCalendarEventClick(info) {
    const eventId = info.event.id;
    const eventDate = info.event.start;
    
    console.log('Клик по событию:', eventId, eventDate);
    
    // Парсим ID события: daily-{itemId}|{dateKey}, weekly-{itemId}|{dateKey}, master-{itemId}
    if (eventId.startsWith('daily-')) {
        // Формат: daily-{itemId}|{dateKey} (используем | как разделитель)
        const separatorIndex = eventId.indexOf('|');
        if (separatorIndex !== -1) {
            const itemId = eventId.substring(6, separatorIndex); // после "daily-"
            const clickedDate = getLocalDateString(eventDate);
            
            const item = items.daily.find(i => i.id === itemId);
            if (item) {
                // Для ежедневных ритуалов используем массив выполненных дат
                // Это позволяет отмечать выполнение на каждую конкретную дату независимо
                if (!item.completedDates) {
                    item.completedDates = [];
                    // Миграция: если есть старый completedDate, добавляем его в массив
                    if (item.completedDate) {
                        const oldDate = item.completedDate.split('T')[0];
                        item.completedDates.push(oldDate);
                    }
                }
                
                const dateIndex = item.completedDates.indexOf(clickedDate);
                if (dateIndex === -1) {
                    // Отмечаем выполнение на эту дату
                    item.completedDates.push(clickedDate);
                    item.completed = true; // для обратной совместимости
                } else {
                    // Снимаем выполнение с этой даты
                    item.completedDates.splice(dateIndex, 1);
                    if (item.completedDates.length === 0) {
                        item.completed = false;
                        // Очищаем старый completedDate для обратной совместимости
                        item.completedDate = null;
                    }
                }
                
                saveData();
                renderAll();
                
                // Обновляем шкалу прогресса
                updateProgressHeart();
                
                // Проверяем, все ли задачи за день выполнены
                checkAllTasksCompleted();
            } else {
                console.warn('Не найден ежедневный ритуал с ID:', itemId);
            }
        } else {
            // Старый формат без разделителя (для обратной совместимости)
            // Пытаемся извлечь itemId и dateKey из старого формата daily-{itemId}-{dateKey}
            const parts = eventId.split('-');
            if (parts.length >= 3) {
                const itemId = parts.slice(1, -1).join('-');
                const clickedDate = getLocalDateString(eventDate);
                const item = items.daily.find(i => i.id === itemId);
                if (item) {
                    item.completedDate = clickedDate;
                    item.completed = true;
                    saveData();
                    renderAll();
                    
                    // Обновляем шкалу прогресса
                    updateProgressHeart();
                    
                    // Проверяем, все ли задачи за день выполнены
                    checkAllTasksCompleted();
                }
            }
        }
    } else if (eventId.startsWith('weekly-')) {
        // Формат: weekly-{itemId}|{dateKey} (используем | как разделитель)
        const separatorIndex = eventId.indexOf('|');
        if (separatorIndex !== -1) {
            const itemId = eventId.substring(7, separatorIndex); // после "weekly-"
            const clickedDate = getLocalDateString(eventDate);
            
            const item = items.weekly.find(i => i.id === itemId);
            if (item) {
                // Для еженедельных ритуалов храним массив выполненных дат
                if (!item.completedDates) {
                    item.completedDates = [];
                }
                
                // Используем toggleComplete для единообразной обработки
                toggleComplete('weekly', itemId, clickedDate);
            } else {
                console.warn('Не найден еженедельный ритуал с ID:', itemId);
            }
        } else {
            // Старый формат без даты (для обратной совместимости)
            const itemId = eventId.replace('weekly-', '');
            toggleComplete('weekly', itemId);
        }
    } else if (eventId.startsWith('master-')) {
        // Формат: master-{itemId}
        const itemId = eventId.replace('master-', '');
        toggleComplete('master', itemId);
    }
}

// Обновление событий в FullCalendar
function updateCalendarEvents() {
    if (!calendar) return;

    const events = buildCalendarEvents();
    calendar.removeAllEvents();
    calendar.addEventSource(events);
}

// Построение списка событий для FullCalendar
function buildCalendarEvents() {
    const events = [];

    // Цвета событий календаря - легко изменить здесь
    const EVENT_COLORS = {
        daily: '#789ED0',      // Ежедневные ритуалы
        weekly: '#7FCBE6',     // Еженедельные ритуалы
        master: '#705575'      // Задачи от Хозяина
    };

    const today = new Date();
    const horizon = new Date();
    horizon.setFullYear(horizon.getFullYear() + 1); // горизонт событий на год вперёд

    // Ежедневные ритуалы: показываем все дни от startDate до горизонта
    // Показываем только активные ритуалы (is_active !== false)
    (items.daily || []).forEach((item) => {
        // Пропускаем неактивные ритуалы
        if (item.is_active === false) {
            return;
        }
        
        const startDateStr = item.startDate || getLocalDateString();
        const start = new Date(startDateStr + 'T00:00:00');

        if (isNaN(start.getTime())) {
            return;
        }

        // Используем цвет для ежедневных ритуалов
        const ritualColor = EVENT_COLORS.daily;

        // Показываем все дни от startDate до горизонта, независимо от completedDate
        for (let d = new Date(start); d <= horizon; d.setDate(d.getDate() + 1)) {
            const dateKey = getLocalDateString(d);
            const timePart = item.time || '00:00';
            
            // Проверяем, выполнено ли событие на эту конкретную дату
            // Для ежедневных ритуалов используем массив выполненных дат или completedDate
            let isCompleted = false;
            
            if (item.completedDates && Array.isArray(item.completedDates)) {
                // Если есть массив выполненных дат, проверяем его
                isCompleted = item.completedDates.includes(dateKey);
            } else if (item.completedDate) {
                // Для обратной совместимости: если есть completedDate, считаем выполненным только эту дату
                const completedDate = item.completedDate.split('T')[0];
                isCompleted = dateKey === completedDate;
            }
            
            events.push({
                id: `daily-${item.id}|${dateKey}`,
                title: item.name,
                start: `${dateKey}T${timePart}`,
                allDay: !item.time,
                backgroundColor: isCompleted ? '#5bb77d' : ritualColor,
                borderColor: isCompleted ? '#5bb77d' : ritualColor,
                textColor: isCompleted ? '#ffffff' : '#ffffff',
                classNames: ['fc-event-daily', isCompleted ? 'fc-event-completed' : ''].filter(Boolean),
                extendedProps: {
                    fullTitle: item.name,
                    isCompleted: isCompleted,
                    ritualColor: ritualColor
                }
            });
        }
    });

    // Еженедельные ритуалы: повторяются в указанный день недели
    const mapDayToIndex = {
        sunday: 0,
        monday: 1,
        tuesday: 2,
        wednesday: 3,
        thursday: 4,
        friday: 5,
        saturday: 6
    };

    (items.weekly || []).forEach((item) => {
        if (!item.day) return;
        const dow = mapDayToIndex[item.day];
        if (dow === undefined) return;

        // Для еженедельных ритуалов создаем события с уникальными ID для каждой недели
        // Генерируем события на год вперед
        const today = new Date();
        const horizon = new Date();
        horizon.setFullYear(horizon.getFullYear() + 1);
        
        // Находим первый день недели с нужным днем недели
        const firstOccurrence = new Date(today);
        const currentDow = firstOccurrence.getDay();
        const daysUntilTarget = (dow - currentDow + 7) % 7;
        firstOccurrence.setDate(firstOccurrence.getDate() + daysUntilTarget);
        
        // Создаем события для каждой недели
        // Используем разделитель "|" чтобы избежать проблем с дефисами в дате
        const weeklyColor = EVENT_COLORS.weekly;
        for (let d = new Date(firstOccurrence); d <= horizon; d.setDate(d.getDate() + 7)) {
            const dateKey = getLocalDateString(d);
            const completedDates = item.completedDates || [];
            const isCompleted = completedDates.includes(dateKey);
            
            events.push({
                id: `weekly-${item.id}|${dateKey}`,
                title: item.name,
                start: `${dateKey}T${item.time || '00:00'}`,
                allDay: !item.time,
                backgroundColor: isCompleted ? '#5bb77d' : weeklyColor,
                borderColor: isCompleted ? '#5bb77d' : weeklyColor,
                textColor: isCompleted ? '#ffffff' : '#ffffff',
                classNames: ['fc-event-weekly', isCompleted ? 'fc-event-completed' : ''].filter(Boolean),
                extendedProps: {
                    fullTitle: item.name
                }
            });
        }
    });

    // Задачи от Хозяина: однократные события в день создания
    const masterColor = EVENT_COLORS.master;
    (items.master || []).forEach((item) => {
        if (!item.createdDate) return;
        const timePart = item.time || '00:00';
        const start = `${item.createdDate}T${timePart}`;

        events.push({
            id: `master-${item.id}`,
            title: item.name,
            start,
            allDay: !item.time,
            backgroundColor: item.completed ? '#5bb77d' : masterColor,
            borderColor: item.completed ? '#5bb77d' : masterColor,
            textColor: item.completed ? '#ffffff' : '#ffffff',
            classNames: ['fc-event-master', item.completed ? 'fc-event-completed' : ''].filter(Boolean),
            extendedProps: {
                fullTitle: item.name
            }
        });
    });

    return events;
}

// Отрисовка списка
function renderList(type) {
    const list = document.getElementById(`${type}-list`);
    if (!list) return; // если для этого типа нет визуального списка
    const typeItems = items[type] || [];

    if (typeItems.length === 0) {
        list.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">📝</div>
                <p>Пока нет задач. Добавьте первую!</p>
            </div>
        `;
        return;
    }

    // Для правил, запретов и ежедневных ритуалов - простой список без чекбоксов
    // Ежедневные ритуалы отмечаются только через календарь
    const isSimpleList = type === 'rules' || type === 'bans' || type === 'daily';
    
    list.innerHTML = typeItems.map(item => {
        // Для ежедневных ритуалов не показываем статус выполнения в списке
        const completedClass = (type === 'daily') ? '' : (item.completed ? 'completed' : '');
        const reminderInfo = item.reminder && item.time 
            ? `<span>⏰ ${item.time}</span>` 
            : '';
        const dayInfo = item.day 
            ? `<span>📅 ${getDayName(item.day)}</span>` 
            : '';
        // Для ежедневных ритуалов не показываем информацию о выполнении
        const completedInfo = (type === 'daily') ? '' : (item.completed && item.completedDate
            ? `<span>✅ Выполнено: ${formatDate(item.completedDate)}</span>`
            : '');

        // Чекбоксы только для master, не для daily и weekly
        const checkboxHtml = (isSimpleList || type === 'daily' || type === 'weekly') ? '' : `
            <input 
                type="checkbox" 
                class="item-checkbox" 
                ${item.completed ? 'checked' : ''}
                onchange="toggleComplete('${type}', '${item.id}')"
            >`;
        
        const metaHtml = isSimpleList ? '' : `
            <div class="item-meta">
                ${reminderInfo}
                ${dayInfo}
                ${completedInfo}
            </div>`;

        // Цветной индикатор убран - используются статичные цвета для каждого типа
        const colorIndicator = '';
        
        // Для ежедневных ритуалов показываем статус активности
        const activeStatus = (type === 'daily' && item.is_active === false)
            ? `<span class="inactive-badge">Неактивен</span>`
            : '';

        return `
            <div class="rounded-md-lg p-5 flex items-center gap-4 transition-all hover:-translate-y-0.5" style="background-color: #E2E2E9; color: #573E5C; box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px -1px rgba(0, 0, 0, 0.1); min-width: 0;" onmouseover="this.style.boxShadow='0 4px 6px -1px rgba(0, 0, 0, 0.15), 0 2px 4px -2px rgba(0, 0, 0, 0.1)';" onmouseout="this.style.boxShadow='0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px -1px rgba(0, 0, 0, 0.1)';">
                ${checkboxHtml ? `<div class="flex-shrink-0">${checkboxHtml}</div>` : ''}
                ${colorIndicator}
                <div class="flex-1 min-w-0" ${item.description ? `data-description="${escapeHtml(item.description).replace(/"/g, '&quot;')}" onclick="if(!event.target.closest('.btn-icon')) { const desc = this.dataset.description; if(desc) showFullDescription(event, desc) }" style="cursor: pointer;"` : ''}>
                    <div class="text-base font-medium mb-1 ${completedClass ? 'line-through' : ''}" style="color: #573E5C;">
                        ${escapeHtml(item.name)}
                        ${activeStatus}
                    </div>
                    ${item.description ? `<div class="text-sm mt-1 item-description" style="color: #573E5C; opacity: 0.8;">${escapeHtml(item.description)}</div>` : ''}
                    ${metaHtml}
                </div>
                <div class="flex gap-2 items-center flex-shrink-0">
                    <button class="btn-icon" onclick="event.stopPropagation(); editItem('${type}', '${item.id}')" title="Редактировать" style="color: #573E5C;">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path>
                        </svg>
                    </button>
                    <button class="btn-icon" onclick="event.stopPropagation(); deleteItem('${type}', '${item.id}')" title="Удалить" style="color: var(--md-error);">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
                        </svg>
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

// Обновление иконки темы
function updateThemeIcon(isDark) {
    const moonIcon = document.getElementById('theme-icon-moon');
    const sunIcon = document.getElementById('theme-icon-sun');
    
    if (!moonIcon || !sunIcon) {
        // Элементы еще не загружены, попробуем позже
        setTimeout(() => updateThemeIcon(isDark), 100);
        return;
    }
    
    if (isDark) {
        // Темная тема активна - показываем солнце (для переключения на светлую)
        moonIcon.classList.add('hidden');
        sunIcon.classList.remove('hidden');
    } else {
        // Светлая тема активна - показываем луну (для переключения на темную)
        moonIcon.classList.remove('hidden');
        sunIcon.classList.add('hidden');
    }
}

// Проверка, установлено ли приложение как PWA
function isPWAInstalled() {
    // Проверка для Android/Chrome - display-mode: standalone
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
    
    // Проверка для iOS Safari - navigator.standalone
    const isIOSStandalone = window.navigator.standalone === true;
    
    // Дополнительные проверки
    // Проверка, что нет адресной строки (для некоторых браузеров)
    const isFullscreen = window.matchMedia('(display-mode: fullscreen)').matches;
    
    // Проверка, запущено ли из главного экрана (для Android)
    const isLaunchedFromHomeScreen = window.matchMedia('(display-mode: minimal-ui)').matches;
    
    // Проверка через window.screen (для некоторых случаев)
    const hasNoAddressBar = window.screen.height - window.innerHeight < 100;
    
    const result = isStandalone || isIOSStandalone || isFullscreen || (isLaunchedFromHomeScreen && hasNoAddressBar);
    
    // Детальное логирование для диагностики
    console.log('[PWA Check] Результаты проверки:');
    console.log('  - display-mode: standalone:', isStandalone);
    console.log('  - navigator.standalone:', isIOSStandalone);
    console.log('  - display-mode: fullscreen:', isFullscreen);
    console.log('  - display-mode: minimal-ui:', isLaunchedFromHomeScreen);
    console.log('  - Нет адресной строки:', hasNoAddressBar);
    console.log('  - Итоговый результат (PWA установлено):', result);
    
    return result;
}

// Проверка и показ модального окна для уведомлений
// Переключение темы
function toggleTheme() {
    const html = document.documentElement;
    const isDark = html.classList.contains('dark');
    
    if (isDark) {
        // Переключаем на светлую тему
        html.classList.remove('dark');
        localStorage.setItem('theme', 'light');
        updateThemeIcon(false);
        console.log('[Theme] Переключено на светлую тему');
    } else {
        // Переключаем на темную тему
        html.classList.add('dark');
        localStorage.setItem('theme', 'dark');
        updateThemeIcon(true);
        console.log('[Theme] Переключено на темную тему');
    }
}

// Закрытие модального окна
function closeModal() {
    const modal = document.getElementById('modal');
    if (!modal) return;
    modal.classList.remove('flex');
    modal.classList.add('hidden');
    editingItemId = null;
}

// Закрытие модального окна при клике вне его
document.addEventListener('click', function(event) {
    const modal = document.getElementById('modal');
    if (modal && event.target === modal) {
        closeModal();
    }
});

// Функция для генерации случайного сообщения напоминания (совпадает с functions/index.js)
function getRandomReminderMessage(ritualName) {
    const messages = [
        `Твой Хозяин ждёт, когда ты его порадуешь - ${ritualName}`,
        `Напоминание от твоего Хозяина: ${ritualName} должно быть выполнено. Я ожидаю отчёта.`,
        `Пора выполнить ${ritualName}, моя хорошая. Сделай это для меня — и ты заслужишь мою похвалу.`,
        `Твой Хозяин проверяет твоё усердие. Готова ли ты доказать, что можешь безупречно выполнить "${ritualName}"?`,
        `${ritualName}. Время пришло. Выполни. Это моя воля.`,
        `Твой долг и твоя честь — исполнить ${ritualName}. Помни, кому ты принадлежишь. Служение начинается сейчас.`
    ];
    
    // Выбираем случайное сообщение
    const randomIndex = Math.floor(Math.random() * messages.length);
    return messages[randomIndex];
}

// Функция для генерации случайного ежедневного сообщения в 19:00 (совпадает с functions/index.js)
function getDaily11AMMessage() {
    const messages = [
        "19:00 — время перерыва и моей гордости за тебя. Ты сегодня справляешься великолепно!",
        "Вечер наступает, и я хочу напомнить: ты важна для меня",
        "19 часов, и я хочу напомнить: твоя улыбка — самый ценный бриллиант в моей коллекции",
        "Вечернее солнце светит не так ярко, как ты. Продолжай сиять",
        "День подходит к концу, а моя нежность к тебе — никогда. Ты моё самое теплое солнышко",
        "Время для вечернего перерыва и моего напоминания: ты заслуживаешь всего самого лучшего",
        "Конец рабочего дня — время моей заботы о тебе. Расслабь плечи, я рядом"
    ];
    
    // Выбираем случайное сообщение
    const randomIndex = Math.floor(Math.random() * messages.length);
    return messages[randomIndex];
}

// Проверка напоминаний с fallback механизмом
// Основной способ: Firebase Cloud Function (когда система работает)
// Fallback: локальная проверка (когда система не работает или токен не сохранен)
function checkReminders() {
    // Всегда проверяем сброс еженедельных задач
    checkWeeklyReset();
    
    // Проверяем, нужно ли использовать fallback (локальную проверку)
    const shouldUseFallback = shouldUseLocalReminderCheck();
    
    if (shouldUseFallback) {
        console.log('[Reminders] 🔄 Используется fallback: локальная проверка напоминаний');
        checkLocalReminders();
    } else {
        console.log('[Reminders] ✅ Используется основной способ: Firebase Cloud Function');
    }
}

// Определение, нужно ли использовать локальную проверку как fallback
function shouldUseLocalReminderCheck() {
    // Используем fallback если:
    // 1. Система уведомлений не работает или работает с ограничениями
    if (notificationSystemStatus === 'failed' || notificationSystemStatus === 'degraded') {
        return true;
    }
    
    // 2. Токен не сохранен или не получен
    if (!fcmToken) {
        return true;
    }
    
    // 3. Разрешение на уведомления не предоставлено
    if (Notification.permission !== 'granted') {
        return true;
    }
    
    // 4. Проверяем, есть ли токен в Firebase (проверяем раз в час)
    const lastTokenCheck = localStorage.getItem('lastTokenFirebaseCheck');
    const now = Date.now();
    const oneHour = 60 * 60 * 1000;
    
    if (!lastTokenCheck || (now - parseInt(lastTokenCheck)) > oneHour) {
        checkTokenInFirebase().then(hasToken => {
            if (!hasToken) {
                console.warn('[Reminders] ⚠️ Токен не найден в Firebase, используем fallback');
            }
            localStorage.setItem('lastTokenFirebaseCheck', now.toString());
        });
    }
    
    return false;
}

// Проверка наличия токена в Firebase
async function checkTokenInFirebase() {
    if (!calendarId) return false;
    
    try {
        const calendarRef = db.collection('calendars').doc(calendarId);
        const calendarDoc = await calendarRef.get();
        if (calendarDoc.exists) {
            const tokens = calendarDoc.data()?.fcmTokens || [];
            return tokens.length > 0 && tokens.includes(fcmToken);
        }
    } catch (error) {
        console.error('[Reminders] Ошибка проверки токена в Firebase:', error);
    }
    return false;
}

// Локальная проверка напоминаний (fallback механизм)
function checkLocalReminders() {
    if (!items || !calendarId) return;
    
    const now = new Date();
    const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const currentDay = getCurrentDayName();
    
    // Ежедневное уведомление в 19:00 (только для PWA в fallback режиме)
    if (currentTime === '19:00') {
        // Проверяем, не отправляли ли уже сегодня уведомление в 19:00
        const last11AMNotification = localStorage.getItem('last11AMNotification');
        const today = new Date().toDateString();
        
        if (!last11AMNotification || last11AMNotification !== today) {
            const message = getDaily11AMMessage();
            showNotification(message, '💝 Твоё напоминание');
            console.log('[Reminders] 💝 Ежедневное уведомление 19:00 (fallback)');
            localStorage.setItem('last11AMNotification', today);
        }
    }
    
    // Проверяем ежедневные ритуалы
    items.daily.forEach(item => {
        if (item.reminder && item.time === currentTime && !item.completed) {
            const message = getRandomReminderMessage(item.name);
            showNotification(message, '🦉 Напоминание');
            console.log('[Reminders] 📅 Ежедневный ритуал:', item.name);
        }
    });
    
    // Проверяем задачи от Хозяина
    items.master.forEach(item => {
        if (item.reminder && item.time === currentTime && !item.completed) {
            const message = getRandomReminderMessage(item.name);
            showNotification(message, '🦉 Напоминание');
            console.log('[Reminders] 📅 Задача от Хозяина:', item.name);
        }
    });
    
    // Проверяем еженедельные ритуалы
    items.weekly.forEach(item => {
        if (item.reminder && item.day === currentDay && item.time === currentTime && !item.completed) {
            const message = getRandomReminderMessage(item.name);
            showNotification(message, '🦉 Напоминание');
            console.log('[Reminders] 📅 Еженедельный ритуал:', item.name);
        }
    });
}

// Проверка сброса еженедельных задач
function checkWeeklyReset() {
    const cacheKey = `lastWeeklyReset_${calendarId}`;
    const lastReset = localStorage.getItem(cacheKey);
    const now = new Date();
    const currentWeek = getWeekNumber(now);

    if (!lastReset || parseInt(lastReset) !== currentWeek) {
        // Сбрасываем выполненные еженедельные задачи
        let hasChanges = false;
        items.weekly.forEach(item => {
            if (item.completed) {
                item.completed = false;
                item.completedDate = null;
                hasChanges = true;
            }
        });
        
        if (hasChanges) {
            localStorage.setItem(cacheKey, currentWeek.toString());
            saveData();
            renderAll();
        } else {
            localStorage.setItem(cacheKey, currentWeek.toString());
        }
    }
}

// Получение номера недели
function getWeekNumber(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

// Получение текущего дня недели
function getCurrentDayName() {
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    return days[new Date().getDay()];
}

// Получение названия дня недели из даты
function getDayNameFromDate(date) {
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    return days[date.getDay()];
}

// Получение названия дня
function getDayName(day) {
    const dayNames = {
        monday: 'Понедельник',
        tuesday: 'Вторник',
        wednesday: 'Среда',
        thursday: 'Четверг',
        friday: 'Пятница',
        saturday: 'Суббота',
        sunday: 'Воскресенье'
    };
    return dayNames[day] || day;
}

// Форматирование даты
function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

// Показ уведомления
async function showNotification(message, title = 'Напоминание') {
    console.log('[Notification] Попытка показать уведомление:', { title, message, permission: Notification.permission });
    
    // Проверяем поддержку уведомлений
    if (!('Notification' in window)) {
        console.warn('[Notification] Уведомления не поддерживаются в этом браузере');
        return;
    }

    // Определяем путь к иконке (используем абсолютный путь от корня сайта)
    let iconPath = '/icon-192.png';
    // Если приложение развернуто в поддиректории, используем правильный путь
    const pathname = window.location.pathname;
    if (pathname.includes('/calendar')) {
        iconPath = '/calendar/icon-192.png';
    } else if (pathname !== '/' && pathname !== '/index.html') {
        const basePath = pathname.replace(/\/[^\/]*$/, '');
        iconPath = `${basePath}/icon-192.png`;
    }
    // Используем абсолютный URL для надежности
    iconPath = new URL(iconPath, window.location.origin).href;

    // Проверяем разрешение
    let permission = Notification.permission;
    
    if (permission === 'default') {
        console.log('[Notification] Запрашиваем разрешение...');
        permission = await Notification.requestPermission();
        console.log('[Notification] Разрешение получено:', permission);
    }

    if (permission === 'granted') {
        try {
            // Пытаемся использовать Service Worker для показа уведомлений (более надежно на Android)
            if ('serviceWorker' in navigator && serviceWorkerRegistration) {
                console.log('[Notification] Используем Service Worker для показа уведомления');
                
                // Вибрация указана в опциях уведомления (vibrate: [200, 100, 200])
                // Не вызываем navigator.vibrate напрямую, так как браузер блокирует это до взаимодействия пользователя
                
                await serviceWorkerRegistration.showNotification(title, {
                    body: message,
                    icon: iconPath,
                    badge: iconPath,
                    tag: 'reminder',
                    requireInteraction: false,
                    vibrate: [200, 100, 200],
                    sound: '', // Звук по умолчанию
                    data: {
                        url: window.location.href
                    }
                });
                console.log('[Notification] Уведомление показано через Service Worker');
            } else {
                // Fallback: используем обычный Notification API
                console.log('[Notification] Используем Notification API');
                
                // Вибрация указана в опциях уведомления (vibrate: [200, 100, 200])
                // Не вызываем navigator.vibrate напрямую, так как браузер блокирует это до взаимодействия пользователя
                
                const notification = new Notification(title, {
                    body: message,
                    icon: iconPath,
                    badge: iconPath,
                    tag: 'reminder',
                    requireInteraction: false,
                    vibrate: [200, 100, 200]
                });
                
                console.log('[Notification] Уведомление создано:', notification);
                
                // Обработка клика по уведомлению
                notification.onclick = () => {
                    console.log('[Notification] Клик по уведомлению');
                    window.focus();
                    notification.close();
                };

                notification.onshow = () => {
                    console.log('[Notification] Уведомление показано');
                };

                notification.onerror = (error) => {
                    console.error('[Notification] Ошибка показа уведомления:', error);
                };

                notification.onclose = () => {
                    console.log('[Notification] Уведомление закрыто');
                };
            }
        } catch (error) {
            console.error('[Notification] Ошибка при показе уведомления:', error);
        }
    } else if (permission === 'denied') {
        console.warn('[Notification] Разрешение на уведомления отклонено пользователем');
    } else {
        console.warn('[Notification] Разрешение на уведомления не предоставлено:', permission);
    }

    // Также логируем
    console.log('[Notification] Напоминание:', message);
}

// Экранирование HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

