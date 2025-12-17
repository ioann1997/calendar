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

// Регистрация Service Worker для PWA
async function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        try {
            const registration = await navigator.serviceWorker.register('/sw.js', {
                scope: '/'
            });
            console.log('[PWA] Service Worker зарегистрирован:', registration.scope);

            // Проверка обновлений
            registration.addEventListener('updatefound', () => {
                const newWorker = registration.installing;
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
        
        // Устанавливаем Service Worker для FCM
        if ('serviceWorker' in navigator) {
            const registration = await navigator.serviceWorker.ready;
            messaging.useServiceWorker(registration);
        }

        // Получаем токен
        fcmToken = await messaging.getToken({
            vapidKey: null // Если используешь VAPID ключ, укажи его здесь
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
        messaging.onTokenRefresh(async () => {
            console.log('[FCM] Токен обновлен');
            fcmToken = await messaging.getToken();
            if (fcmToken) {
                await saveFCMToken(fcmToken);
            }
        });

    } catch (error) {
        console.error('[FCM] Ошибка инициализации:', error);
    }
}

// Сохранение FCM токена в Firebase
async function saveFCMToken(token) {
    if (!calendarId) return;
    
    try {
        const calendarRef = db.collection('calendars').doc(calendarId);
        await calendarRef.update({
            fcmTokens: firebase.firestore.FieldValue.arrayUnion(token),
            lastTokenUpdate: firebase.firestore.FieldValue.serverTimestamp()
        });
        console.log('[FCM] Токен сохранен в Firebase');
    } catch (error) {
        console.error('[FCM] Ошибка сохранения токена:', error);
    }
}

// Переключение мобильного меню
function toggleMobileMenu() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('mobile-menu-overlay');
    if (sidebar && overlay) {
        sidebar.classList.toggle('mobile-open');
        overlay.classList.toggle('active');
    }
}

// Показ информации о календаре
function showCalendarInfo() {
    const infoDiv = document.getElementById('calendar-info');
    const idDisplay = document.getElementById('calendar-id-display');
    
    if (infoDiv && idDisplay) {
        infoDiv.style.display = 'flex';
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
            tabButtons.forEach(b => b.classList.remove('active'));
            tabContents.forEach(c => c.classList.remove('active'));
            
            btn.classList.add('active');
            document.getElementById(tabId).classList.add('active');
            
            currentTab = tabId;
            
            // Закрываем мобильное меню при выборе вкладки
            const sidebar = document.getElementById('sidebar');
            const overlay = document.getElementById('mobile-menu-overlay');
            if (sidebar && overlay && window.innerWidth <= 768) {
                sidebar.classList.remove('mobile-open');
                overlay.classList.remove('active');
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
        timeGroup.style.display = reminderCheckbox.checked ? 'block' : 'none';
        if (currentTab === 'weekly') {
            dayGroup.style.display = reminderCheckbox.checked ? 'block' : 'none';
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
        timeGroup.style.display = reminderCheckbox.checked ? 'block' : 'none';
        if (currentTab === 'weekly') {
            dayGroup.style.display = reminderCheckbox.checked ? 'block' : 'none';
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
        if (btn.dataset.tab === type) {
            btn.classList.add('active');
        }
    });
    
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
        if (content.id === type) {
            content.classList.add('active');
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
    
    // Скрываем поля напоминаний для простых списков
    if (isSimpleList) {
        document.getElementById('item-reminder').closest('.form-group').style.display = 'none';
        document.getElementById('time-group').style.display = 'none';
        document.getElementById('day-group').style.display = 'none';
    } else {
        document.getElementById('item-reminder').closest('.form-group').style.display = 'block';
        document.getElementById('time-group').style.display = 'none';
        document.getElementById('day-group').style.display = 'none';
    }
    
    // Показываем модальное окно
    document.getElementById('modal').classList.add('active');
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
    
    if (isSimpleList) {
        document.getElementById('item-reminder').closest('.form-group').style.display = 'none';
        document.getElementById('time-group').style.display = 'none';
        document.getElementById('day-group').style.display = 'none';
    } else {
        document.getElementById('item-reminder').closest('.form-group').style.display = 'block';
        document.getElementById('item-reminder').checked = item.reminder || false;
        
        if (item.reminder) {
            document.getElementById('time-group').style.display = 'block';
            if (item.time) {
                document.getElementById('item-time').value = item.time;
            }
            if (type === 'weekly' && item.day) {
                document.getElementById('day-group').style.display = 'block';
                document.getElementById('item-day').value = item.day;
            }
        } else {
            document.getElementById('time-group').style.display = 'none';
            document.getElementById('day-group').style.display = 'none';
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

    const item = {
        id: editingItemId || Date.now().toString(),
        name,
        description: description || '',
        reminder: isSimpleList ? false : reminder,
        time: isSimpleList ? null : time,
        day: isSimpleList ? null : day,
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

    const today = new Date();
    const horizon = new Date();
    horizon.setFullYear(horizon.getFullYear() + 1); // горизонт событий на год вперёд

    // Ежедневные ритуалы: показываем все дни от startDate до горизонта
    // completedDate используется только для визуального отображения (зачеркнутые)
    (items.daily || []).forEach((item) => {
        const startDateStr = item.startDate || getLocalDateString();
        const start = new Date(startDateStr + 'T00:00:00');

        if (isNaN(start.getTime())) {
            return;
        }

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
                classNames: ['fc-event-daily', isCompleted ? 'fc-event-completed' : ''].filter(Boolean),
                extendedProps: {
                    fullTitle: item.name
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
        for (let d = new Date(firstOccurrence); d <= horizon; d.setDate(d.getDate() + 7)) {
            const dateKey = getLocalDateString(d);
            const completedDates = item.completedDates || [];
            const isCompleted = completedDates.includes(dateKey);
            
            events.push({
                id: `weekly-${item.id}|${dateKey}`,
                title: item.name,
                start: `${dateKey}T${item.time || '00:00'}`,
                allDay: !item.time,
                classNames: ['fc-event-weekly', isCompleted ? 'fc-event-completed' : ''].filter(Boolean),
                extendedProps: {
                    fullTitle: item.name
                }
            });
        }
    });

    // Задачи от Господина: однократные события в день создания
    (items.master || []).forEach((item) => {
        if (!item.createdDate) return;
        const timePart = item.time || '00:00';
        const start = `${item.createdDate}T${timePart}`;

        events.push({
            id: `master-${item.id}`,
            title: item.name,
            start,
            allDay: !item.time,
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

    // Для правил и запретов - простой список без чекбоксов
    const isSimpleList = type === 'rules' || type === 'bans';
    
    list.innerHTML = typeItems.map(item => {
        const completedClass = item.completed ? 'completed' : '';
        const reminderInfo = item.reminder && item.time 
            ? `<span>⏰ ${item.time}</span>` 
            : '';
        const dayInfo = item.day 
            ? `<span>📅 ${getDayName(item.day)}</span>` 
            : '';
        const completedInfo = item.completed && item.completedDate
            ? `<span>✅ Выполнено: ${formatDate(item.completedDate)}</span>`
            : '';

        const checkboxHtml = isSimpleList ? '' : `
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

        return `
            <div class="item ${completedClass}">
                ${checkboxHtml}
                <div class="item-content">
                    <div class="item-name">${escapeHtml(item.name)}</div>
                    ${item.description ? `<div class="item-description">${escapeHtml(item.description)}</div>` : ''}
                    ${metaHtml}
                </div>
                <div class="item-actions">
                    <button class="btn-icon" onclick="editItem('${type}', '${item.id}')" title="Редактировать">✏️</button>
                    <button class="btn-icon btn-delete" onclick="deleteItem('${type}', '${item.id}')" title="Удалить">🗑️</button>
                </div>
            </div>
        `;
    }).join('');
}

// Закрытие модального окна
function closeModal() {
    document.getElementById('modal').classList.remove('active');
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

    // Проверяем ежедневные ритуалы
    items.daily.forEach(item => {
        if (item.reminder && item.time && !item.completed) {
            if (item.time === currentTime) {
                showNotification(`Ежедневный ритуал: ${item.name}`);
            }
        }
    });

    // Проверяем задачи от Господина
    items.master.forEach(item => {
        if (item.reminder && item.time && !item.completed) {
            if (item.time === currentTime) {
                showNotification(`Задача от Господина: ${item.name}`);
            }
        }
    });

    // Проверяем еженедельные ритуалы
    items.weekly.forEach(item => {
        if (item.reminder && item.day && item.time && !item.completed) {
            if (item.day === currentDay && item.time === currentTime) {
                showNotification(`Еженедельный ритуал: ${item.name}`);
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
    // Проверяем поддержку уведомлений
    if ('Notification' in window && Notification.permission === 'granted') {
        const notification = new Notification(title, {
            body: message,
            icon: '/icon-192.png',
            badge: '/icon-192.png',
            tag: 'reminder',
            requireInteraction: false,
            vibrate: [200, 100, 200]
        });
        
        // Обработка клика по уведомлению
        notification.onclick = () => {
            window.focus();
            notification.close();
        };
    } else if ('Notification' in window && Notification.permission !== 'denied') {
        const permission = await Notification.requestPermission();
        if (permission === 'granted') {
            const notification = new Notification(title, {
                body: message,
                icon: '/icon-192.png',
                badge: '/icon-192.png',
                tag: 'reminder',
                requireInteraction: false,
                vibrate: [200, 100, 200]
            });
            
            notification.onclick = () => {
                window.focus();
                notification.close();
            };
        }
    }

    // Также логируем
    console.log('Напоминание:', message);
}

// Экранирование HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
