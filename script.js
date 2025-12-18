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

// Инициализация
document.addEventListener('DOMContentLoaded', async () => {
    // Загружаем сохраненную тему
    const savedTheme = localStorage.getItem('theme') || 'light';
    if (savedTheme === 'dark') {
        document.documentElement.classList.add('dark');
    }
    updateThemeIcon(savedTheme === 'dark');
    
    // Регистрация Service Worker для PWA
    registerServiceWorker();
    
    await initializeCalendar();
    setupTabs();
    setupForm();
    initFullCalendar();
    checkReminders();
    setupReminderCheck();
    
    // Инициализация Firebase Cloud Messaging для Push-уведомлений
    initializeFirebaseMessaging();
    
    // Запрос разрешения на уведомления при загрузке
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
    }
    
    // Проверка напоминаний каждую минуту
    setInterval(checkReminders, 60000);
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

            // Проверка обновлений
            serviceWorkerRegistration.addEventListener('updatefound', () => {
                const newWorker = serviceWorkerRegistration.installing;
                newWorker.addEventListener('statechange', () => {
                    if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                        // Новый Service Worker доступен, можно обновить
                        console.log('[PWA] Доступна новая версия приложения');
                        if (confirm('Доступна новая версия приложения. Обновить?')) {
                            newWorker.postMessage({ type: 'SKIP_WAITING' });
                            window.location.reload();
                        }
                    }
                });
            });

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
        // Запрашиваем разрешение на уведомления
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
            console.log('[FCM] Разрешение на уведомления не предоставлено');
            return;
        }

        // Получаем токен FCM
        const messaging = firebase.messaging();
        
        // Ждем готовности Service Worker и передаем его в getToken
        // Это нужно, чтобы Firebase использовал существующий Service Worker
        // вместо попытки зарегистрировать firebase-messaging-sw.js
        let registration = serviceWorkerRegistration;
        if (!registration) {
            registration = await navigator.serviceWorker.ready;
        }

        // Получаем токен с указанием Service Worker регистрации
        fcmToken = await messaging.getToken({
            vapidKey: null, // Если используешь VAPID ключ, укажи его здесь
            serviceWorkerRegistration: registration
        });

        if (fcmToken) {
            console.log('[FCM] Токен получен:', fcmToken);
            // Сохраняем токен в Firebase для отправки уведомлений
            await saveFCMToken(fcmToken);
        } else {
            console.warn('[FCM] Не удалось получить токен');
        }

        // Обработка входящих сообщений (когда приложение открыто)
        messaging.onMessage((payload) => {
            console.log('[FCM] Получено сообщение:', payload);
            showNotification(payload.notification?.body || payload.data?.body || 'Напоминание');
        });

        // Обработка обновления токена
        // В Firebase 10.7.1+ onTokenRefresh заменен на onTokenRefresh
        // Используем обработчик через messaging.onTokenRefresh (если доступен)
        // или слушаем события через messaging.onMessage
        // Примечание: в новых версиях токен обновляется автоматически при вызове getToken()

    } catch (error) {
        console.error('[FCM] Ошибка инициализации:', error);
    }
}

// Сохранение FCM токена в Firebase
async function saveFCMToken(token) {
    if (!calendarId) {
        console.warn('[FCM] calendarId не установлен, токен не сохранен');
        return;
    }
    
    try {
        console.log(`[FCM] Сохранение токена в календарь: ${calendarId}`);
        const calendarRef = db.collection('calendars').doc(calendarId);
        
        // Получаем текущие токены
        const calendarDoc = await calendarRef.get();
        const currentTokens = calendarDoc.data()?.fcmTokens || [];
        
        // Получаем старый токен этого устройства из localStorage
        const oldToken = localStorage.getItem('fcmToken');
        
        // Удаляем старый токен этого устройства, если он есть
        let updatedTokens = currentTokens.filter(t => t !== oldToken);
        
        // Добавляем новый токен, если его еще нет
        if (!updatedTokens.includes(token)) {
            updatedTokens.push(token);
        }
        
        // Ограничиваем количество токенов (максимум 3 - для нескольких устройств)
        // Оставляем только последние 3 токена
        if (updatedTokens.length > 3) {
            updatedTokens = updatedTokens.slice(-3);
            console.log(`[FCM] Ограничение: оставлено только последние 3 токена`);
        }
        
        // Сохраняем обновленный массив токенов
        await calendarRef.update({
            fcmTokens: updatedTokens,
            lastTokenUpdate: firebase.firestore.FieldValue.serverTimestamp()
        });
        
        // Сохраняем новый токен в localStorage для следующего обновления
        localStorage.setItem('fcmToken', token);
        
        console.log(`[FCM] Токен сохранен в Firebase для календаря: ${calendarId} (всего токенов: ${updatedTokens.length})`);
    } catch (error) {
        console.error('[FCM] Ошибка сохранения токена:', error);
    }
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
            (doc) => {
                if (doc.exists) {
                    const data = doc.data();
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
                } else {
                    // Документ не существует, создаем пустой
                    saveDataToFirebase();
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
        await calendarRef.set({
            daily: items.daily || [],
            master: items.master || [],
            weekly: items.weekly || [],
            rules: items.rules || [],
            bans: items.bans || [],
            lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        
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

// Настройка вкладок
function setupTabs() {
    const tabButtons = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');

    tabButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const tabId = btn.dataset.tab;
            
            // Обновляем активные классы
            tabButtons.forEach(b => {
                b.classList.remove('active');
                b.style.color = 'var(--md-primary)';
                b.style.backgroundColor = 'transparent';
            });
            tabContents.forEach(c => {
                c.classList.remove('active', 'block');
                c.classList.add('hidden');
            });
            
            btn.classList.add('active');
            btn.style.color = 'var(--md-primary)';
            btn.style.backgroundColor = '#EDEDF4';
            
            const activeContent = document.getElementById(tabId);
            activeContent.classList.add('active', 'block');
            activeContent.classList.remove('hidden');
            
            currentTab = tabId;
            
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

    reminderCheckbox.addEventListener('change', () => {
        if (reminderCheckbox.checked) {
            timeGroup.classList.remove('hidden');
            timeGroup.classList.add('flex');
            if (currentTab === 'weekly') {
                dayGroup.classList.remove('hidden');
                dayGroup.classList.add('flex');
            }
        } else {
            timeGroup.classList.add('hidden');
            timeGroup.classList.remove('flex');
            dayGroup.classList.add('hidden');
            dayGroup.classList.remove('flex');
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
    editingItemId = null;
    currentTab = type;
    
    // Переключаемся на нужную вкладку
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
        btn.style.color = 'var(--md-on-surface-variant)';
        btn.style.borderLeft = 'none';
        btn.style.backgroundColor = 'transparent';
        btn.style.opacity = '1';
        if (btn.dataset.tab === type) {
            btn.classList.add('active');
            btn.style.color = 'var(--md-primary)';
            btn.style.borderLeft = '2px solid var(--md-primary)';
            btn.style.backgroundColor = 'var(--md-primary-container)';
            btn.style.opacity = '0.12';
        }
    });
    
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active', 'block');
        content.classList.add('hidden');
        if (content.id === type) {
            content.classList.add('active', 'block');
            content.classList.remove('hidden');
        }
    });

    // Очищаем форму
    document.getElementById('item-form').reset();
    
    // Для правил и запретов - простая форма
    const isSimpleList = type === 'rules' || type === 'bans';
    const titles = {
        'daily': 'Добавить ежедневный ритуал',
        'master': 'Добавить задачу от Господина',
        'weekly': 'Добавить еженедельный ритуал',
        'rules': 'Добавить правило',
        'bans': 'Добавить запрет'
    };
    
    document.getElementById('modal-title').textContent = titles[type] || 'Добавить задачу';
    
    // Скрываем/показываем поля в зависимости от типа
    const reminderGroup = document.getElementById('item-reminder').closest('.flex');
    const timeGroup = document.getElementById('time-group');
    const dayGroup = document.getElementById('day-group');
    const colorGroup = document.getElementById('color-group');
    const isActiveGroup = document.getElementById('is-active-group');
    
    if (isSimpleList) {
        reminderGroup?.classList.add('hidden');
        timeGroup.classList.add('hidden');
        dayGroup.classList.add('hidden');
        colorGroup.classList.add('hidden');
        isActiveGroup.classList.add('hidden');
    } else {
        reminderGroup?.classList.remove('hidden');
        timeGroup.classList.add('hidden');
        dayGroup.classList.add('hidden');
        // Поля color и is_active только для ежедневных ритуалов
        if (type === 'daily') {
            colorGroup.classList.remove('hidden');
            isActiveGroup.classList.remove('hidden');
        } else {
            colorGroup.classList.add('hidden');
            isActiveGroup.classList.add('hidden');
        }
    }
    
    // Показываем модальное окно
    const modal = document.getElementById('modal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

// Редактирование элемента
function editItem(type, id) {
    const item = items[type].find(i => i.id === id);
    if (!item) return;

    editingItemId = id;
    currentTab = type;

    // Заполняем форму
    document.getElementById('item-name').value = item.name;
    document.getElementById('item-description').value = item.description || '';
    
    // Для правил и запретов - простая форма
    const isSimpleList = type === 'rules' || type === 'bans';
    
    const reminderGroup = document.getElementById('item-reminder').closest('.flex');
    const timeGroup = document.getElementById('time-group');
    const dayGroup = document.getElementById('day-group');
    const colorGroup = document.getElementById('color-group');
    const isActiveGroup = document.getElementById('is-active-group');
    
    if (isSimpleList) {
        reminderGroup?.classList.add('hidden');
        timeGroup.classList.add('hidden');
        dayGroup.classList.add('hidden');
        colorGroup.classList.add('hidden');
        isActiveGroup.classList.add('hidden');
    } else {
        reminderGroup?.classList.remove('hidden');
        document.getElementById('item-reminder').checked = item.reminder || false;
        
        // Заполняем поля для ежедневных ритуалов
        if (type === 'daily') {
            colorGroup.classList.remove('hidden');
            isActiveGroup.classList.remove('hidden');
            if (item.color) {
                document.getElementById('item-color').value = item.color;
            }
            document.getElementById('item-is-active').checked = item.is_active !== false;
        } else {
            colorGroup.classList.add('hidden');
            isActiveGroup.classList.add('hidden');
        }
        
        if (item.reminder) {
            timeGroup.classList.remove('hidden');
            if (item.time) {
                document.getElementById('item-time').value = item.time;
            }
            if (type === 'weekly' && item.day) {
                dayGroup.classList.remove('hidden');
                document.getElementById('item-day').value = item.day;
            } else {
                dayGroup.classList.add('hidden');
            }
        } else {
            timeGroup.classList.add('hidden');
            dayGroup.classList.add('hidden');
        }
    }

    const titles = {
        'daily': 'Редактировать ежедневный ритуал',
        'master': 'Редактировать задачу от Господина',
        'weekly': 'Редактировать еженедельный ритуал',
        'rules': 'Редактировать правило',
        'bans': 'Редактировать запрет'
    };
    
    document.getElementById('modal-title').textContent = titles[type] || 'Редактировать задачу';
    document.getElementById('modal').classList.add('active');
}

// Сохранение элемента
function saveItem() {
    const name = document.getElementById('item-name').value.trim();
    const description = document.getElementById('item-description').value.trim();
    
    // Для правил и запретов - простой список без напоминаний
    const isSimpleList = currentTab === 'rules' || currentTab === 'bans';
    
    const reminder = isSimpleList ? false : document.getElementById('item-reminder').checked;
    const time = (isSimpleList || !reminder) ? null : document.getElementById('item-time').value;
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
    const color = (currentTab === 'daily') ? (document.getElementById('item-color')?.value || '#ea580c') : undefined;
    const isActive = (currentTab === 'daily') ? (document.getElementById('item-is-active')?.checked !== false) : undefined;

    const item = {
        id: editingItemId || Date.now().toString(),
        name,
        description: description || '',
        reminder: isSimpleList ? false : reminder,
        time: isSimpleList ? null : time,
        day: isSimpleList ? null : day,
        // Для ежедневных ритуалов добавляем color и is_active
        color: currentTab === 'daily' ? color : undefined,
        is_active: currentTab === 'daily' ? isActive : undefined,
        completed: editingItemId ? (baseExisting?.completed || false) : false,
        completedDate: editingItemId ? baseExisting?.completedDate : null,
        // для ежедневных и еженедельных ритуалов сохраняем массив выполненных дат
        completedDates: ((currentTab === 'daily' || currentTab === 'weekly') && baseExisting?.completedDates) ? baseExisting.completedDates : undefined,
        startDate,
        // для задач от Господина запоминаем день постановки
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
    
    if (item.color === undefined) {
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
    closeModal();
}

// Удаление элемента
function deleteItem(type, id) {
    if (confirm('Вы уверены, что хотите удалить эту задачу?')) {
        items[type] = items[type].filter(i => i.id !== id);
        saveData();
        renderAll();
    }
}

// Переключение выполнения
function toggleComplete(type, id) {
    // Для правил и запретов нет статуса выполнения
    if (type === 'rules' || type === 'bans') return;
    
    const item = items[type].find(i => i.id === id);
    if (!item) return;

    if (item.completed) {
        item.completed = false;
        item.completedDate = null;
    } else {
        item.completed = true;
        // для ежедневных ритуалов считаем датой завершения текущий день (без времени)
        if (type === 'daily') {
            item.completedDate = getLocalDateString();
        } else {
            item.completedDate = new Date().toISOString();
        }
    }

    saveData();
    renderAll();
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
        height: 'auto',
        contentHeight: 'auto',
        headerToolbar: {
            left: 'prev,next today',
            center: 'title',
            right: 'dayGridDay,dayGridWeek'
        },
        buttonText: {
            today: 'Сегодня'
        },
        views: {
            dayGridDay: {
                titleFormat: { year: 'numeric', month: 'long', day: 'numeric' },
                buttonText: 'День'
            },
            dayGridWeek: {
                titleFormat: { year: 'numeric', month: 'long', day: 'numeric' },
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
        eventDidMount: function(info) {
            // Добавляем title для tooltip при наведении
            const fullTitle = info.event.extendedProps.fullTitle || info.event.title;
            if (info.el) {
                info.el.setAttribute('title', fullTitle);
            }
        }
    });

    calendar.render();
    updateCalendarEvents();
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
                    }
                }
                
                saveData();
                renderAll();
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
        master: '#705575'      // Задачи от Господина
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
                backgroundColor: isCompleted ? '#6b7280' : ritualColor,
                borderColor: isCompleted ? '#4b5563' : ritualColor,
                textColor: isCompleted ? '#d1d5db' : '#ffffff',
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
                backgroundColor: isCompleted ? '#6b7280' : weeklyColor,
                borderColor: isCompleted ? '#4b5563' : weeklyColor,
                textColor: isCompleted ? '#d1d5db' : '#ffffff',
                classNames: ['fc-event-weekly', isCompleted ? 'fc-event-completed' : ''].filter(Boolean),
                extendedProps: {
                    fullTitle: item.name
                }
            });
        }
    });

    // Задачи от Господина: однократные события в день создания
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
            backgroundColor: item.completed ? '#6b7280' : masterColor,
            borderColor: item.completed ? '#4b5563' : masterColor,
            textColor: item.completed ? '#d1d5db' : '#ffffff',
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

        // Чекбоксы только для master и weekly, не для daily
        const checkboxHtml = (isSimpleList || type === 'daily') ? '' : `
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

        // Для ежедневных ритуалов добавляем цветной индикатор
        const colorIndicator = (type === 'daily' && item.color) 
            ? `<span class="color-indicator" style="background-color: ${item.color}; border-color: ${item.color};"></span>`
            : '';
        
        // Для ежедневных ритуалов показываем статус активности
        const activeStatus = (type === 'daily' && item.is_active === false)
            ? `<span class="inactive-badge">Неактивен</span>`
            : '';

        return `
            <div class="rounded-md-lg p-5 flex items-center gap-4 transition-all hover:-translate-y-0.5 ${completedClass ? 'opacity-70' : ''}" style="background-color: #E2E2E9; color: #573E5C; box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px -1px rgba(0, 0, 0, 0.1);" onmouseover="this.style.boxShadow='0 4px 6px -1px rgba(0, 0, 0, 0.15), 0 2px 4px -2px rgba(0, 0, 0, 0.1)';" onmouseout="this.style.boxShadow='0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px -1px rgba(0, 0, 0, 0.1)';">
                ${checkboxHtml}
                ${colorIndicator}
                <div class="flex-1">
                    <div class="text-base font-medium mb-1 ${completedClass ? 'line-through' : ''}" style="color: #573E5C;">
                        ${escapeHtml(item.name)}
                        ${activeStatus}
                    </div>
                    ${item.description ? `<div class="text-sm mt-1" style="color: #573E5C; opacity: 0.8;">${escapeHtml(item.description)}</div>` : ''}
                    ${metaHtml}
                </div>
                <div class="flex gap-2">
                    <button class="btn-icon" onclick="editItem('${type}', '${item.id}')" title="Редактировать" style="color: #573E5C;">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path>
                        </svg>
                    </button>
                    <button class="btn-icon" onclick="deleteItem('${type}', '${item.id}')" title="Удалить" style="color: var(--md-error);">
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
    modal.classList.remove('flex');
    modal.classList.add('hidden');
    editingItemId = null;
}

// Закрытие модального окна при клике вне его
window.onclick = function(event) {
    const modal = document.getElementById('modal');
    if (event.target === modal) {
        closeModal();
    }
}

// Проверка напоминаний
function checkReminders() {
    const now = new Date();
    const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const currentDay = getCurrentDayName();

    // Отладочное логирование (можно отключить в продакшене)
    console.log(`[Reminders] Проверка напоминаний: ${currentTime}, день: ${currentDay}`);

    // Проверяем ежедневные ритуалы
    items.daily.forEach(item => {
        if (item.reminder && item.time && !item.completed) {
            if (item.time === currentTime) {
                console.log(`[Reminders] Сработало ежедневное напоминание: ${item.name} в ${item.time}`);
                showNotification(`Ежедневный ритуал: ${item.name}`);
            }
        }
    });

    // Проверяем задачи от Господина
    items.master.forEach(item => {
        if (item.reminder && item.time && !item.completed) {
            if (item.time === currentTime) {
                console.log(`[Reminders] Сработало напоминание задачи: ${item.name} в ${item.time}`);
                showNotification(`Задача от Господина: ${item.name}`);
            }
        }
    });

    // Проверяем еженедельные ритуалы
    items.weekly.forEach(item => {
        if (item.reminder && item.day && item.time && !item.completed) {
            if (item.day === currentDay && item.time === currentTime) {
                console.log(`[Reminders] Сработало еженедельное напоминание: ${item.name} в ${item.day} ${item.time}`);
                showNotification(`Еженедельный ритуал: ${item.name}`);
            } else {
                // Отладочное логирование для еженедельных
                if (item.day === currentDay) {
                    console.log(`[Reminders] Еженедельное напоминание "${item.name}": день совпадает (${currentDay}), но время не совпадает (ожидается ${item.time}, сейчас ${currentTime})`);
                }
            }
        }
    });

    // Проверяем сброс еженедельных задач
    checkWeeklyReset();
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

    // Определяем базовый путь для иконок
    const basePath = window.location.pathname.replace(/\/[^\/]*$/, '') || '/calendar';
    const iconPath = `${basePath}/icon-192.png`;

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
                
                // Вибрация через Vibration API (для Android)
                if ('vibrate' in navigator) {
                    try {
                        navigator.vibrate([200, 100, 200]);
                        console.log('[Notification] Вибрация активирована');
                    } catch (e) {
                        console.warn('[Notification] Ошибка вибрации:', e);
                    }
                }
                
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
                
                // Вибрация через Vibration API (для Android)
                if ('vibrate' in navigator) {
                    try {
                        navigator.vibrate([200, 100, 200]);
                        console.log('[Notification] Вибрация активирована');
                    } catch (e) {
                        console.warn('[Notification] Ошибка вибрации:', e);
                    }
                }
                
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
