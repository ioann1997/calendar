// Данные приложения
let items = {
    daily: [],
    master: [],
    weekly: []
};

let currentTab = 'daily';
let editingItemId = null;
let calendarId = null;
let unsubscribeFirestore = null;
let isInitialized = false;
let calendar = null;

// Инициализация
document.addEventListener('DOMContentLoaded', async () => {
    await initializeCalendar();
    setupTabs();
    setupForm();
    initFullCalendar();
    checkReminders();
    setupReminderCheck();
    
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
    
    if (!calendarId) {
        // Создаем новый calendarId
        calendarId = generateCalendarId();
        // Обновляем URL без перезагрузки страницы
        const newUrl = window.location.origin + window.location.pathname + '?c=' + calendarId;
        window.history.replaceState({}, '', newUrl);
    }
    
    // Показываем информацию о календаре
    showCalendarInfo();
    
    // Загружаем данные из Firebase
    await loadDataFromFirebase();
    
    isInitialized = true;
}

// Генерация уникального ID календаря
function generateCalendarId() {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
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
                        weekly: data.weekly || []
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
                console.error('Ошибка синхронизации с Firebase:', error);
                // Используем данные из кэша при ошибке
                loadDataFromCache();
                renderAll();
            }
        );
    } catch (error) {
        console.error('Ошибка подключения к Firebase:', error);
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
            lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        
        // Также сохраняем в кэш
        saveDataToCache();
    } catch (error) {
        console.error('Ошибка сохранения в Firebase:', error);
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
    document.getElementById('modal-title').textContent = 'Добавить задачу';
    document.getElementById('time-group').style.display = 'none';
    document.getElementById('day-group').style.display = type === 'weekly' ? 'none' : 'none';
    
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
    }

    document.getElementById('modal-title').textContent = 'Редактировать задачу';
    document.getElementById('modal').classList.add('active');
}

// Сохранение элемента
function saveItem() {
    const name = document.getElementById('item-name').value.trim();
    const description = document.getElementById('item-description').value.trim();
    const reminder = document.getElementById('item-reminder').checked;
    const time = reminder ? document.getElementById('item-time').value : null;
    const day = (currentTab === 'weekly' && reminder) ? document.getElementById('item-day').value : null;

    if (!name) return;

    const baseExisting = editingItemId ? items[currentTab].find(i => i.id === editingItemId) : null;

    const item = {
        id: editingItemId || Date.now().toString(),
        name,
        description,
        reminder,
        time,
        day,
        completed: editingItemId ? (baseExisting?.completed || false) : false,
        completedDate: editingItemId ? baseExisting?.completedDate : null,
        // для задач от Господина запоминаем день постановки
        createdDate: currentTab === 'master'
            ? (baseExisting?.createdDate || new Date().toISOString().split('T')[0])
            : baseExisting?.createdDate
    };

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
    const item = items[type].find(i => i.id === id);
    if (!item) return;

    if (item.completed) {
        item.completed = false;
        item.completedDate = null;
    } else {
        item.completed = true;
        item.completedDate = new Date().toISOString();
    }

    saveData();
    renderAll();
}

// Отрисовка всех списков
function renderAll() {
    renderList('daily');
    renderList('master');
    renderList('weekly');
    updateCalendarEvents();
}

// Инициализация FullCalendar
function initFullCalendar() {
    const calendarEl = document.getElementById('fullcalendar');
    if (!calendarEl || typeof FullCalendar === 'undefined') return;

    calendar = new FullCalendar.Calendar(calendarEl, {
        initialView: 'dayGridMonth',
        locale: 'ru',
        firstDay: 1,
        height: 'auto',
        headerToolbar: {
            left: 'prev,next today',
            center: 'title',
            right: ''
        },
        dayMaxEvents: 3,
        editable: false,
        selectable: false
    });

    calendar.render();
    updateCalendarEvents();
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

    // Ежедневные ритуалы: повторяются каждый день
    (items.daily || []).forEach((item) => {
        events.push({
            id: `daily-${item.id}`,
            title: item.name,
            daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
            startTime: item.time || '00:00',
            classNames: ['fc-event-daily']
        });
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

        events.push({
            id: `weekly-${item.id}`,
            title: item.name,
            daysOfWeek: [dow],
            startTime: item.time || '00:00',
            classNames: ['fc-event-weekly']
        });
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
            classNames: ['fc-event-master']
        });
    });

    return events;
}

// Отрисовка списка
function renderList(type) {
    const list = document.getElementById(`${type}-list`);
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

        return `
            <div class="item ${completedClass}">
                <input 
                    type="checkbox" 
                    class="item-checkbox" 
                    ${item.completed ? 'checked' : ''}
                    onchange="toggleComplete('${type}', '${item.id}')"
                >
                <div class="item-content">
                    <div class="item-name">${escapeHtml(item.name)}</div>
                    ${item.description ? `<div class="item-description">${escapeHtml(item.description)}</div>` : ''}
                    <div class="item-meta">
                        ${reminderInfo}
                        ${dayInfo}
                        ${completedInfo}
                    </div>
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
function showNotification(message) {
    // Проверяем поддержку уведомлений
    if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('Напоминание', {
            body: message,
            icon: '📅'
        });
    } else if ('Notification' in window && Notification.permission !== 'denied') {
        Notification.requestPermission().then(permission => {
            if (permission === 'granted') {
                new Notification('Напоминание', {
                    body: message,
                    icon: '📅'
                });
            }
        });
    }

    // Также показываем alert как запасной вариант
    console.log('Напоминание:', message);
}

// Экранирование HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
