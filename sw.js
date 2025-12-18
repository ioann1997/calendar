// Service Worker для PWA и Firebase Cloud Messaging
// Версия кэша - обновляй при изменении файлов
const CACHE_NAME = 'sovinaya-napominalka-v5';
const RUNTIME_CACHE = 'runtime-cache-v4';

// Определяем базовый путь автоматически (для GitHub Pages)
// Если sw.js находится в /calendar/sw.js, то BASE_PATH будет /calendar
const BASE_PATH = (() => {
  let path = self.location.pathname.split('/sw.js')[0] || '';
  // Убираем завершающий слэш, если он есть (кроме корня)
  if (path !== '/' && path.endsWith('/')) {
    path = path.slice(0, -1);
  }
  return path;
})();

// Файлы для кэширования при установке
const STATIC_CACHE_URLS = [
  BASE_PATH + '/',
  BASE_PATH + '/index.html',
  BASE_PATH + '/styles.css',
  BASE_PATH + '/script.js',
  BASE_PATH + '/firebase-config.js',
  BASE_PATH + '/manifest.json',
  BASE_PATH + '/icon-192.png',
  BASE_PATH + '/icon-512.png',
  // FullCalendar CSS не нужен - стили встроены в JS файл
  'https://cdn.jsdelivr.net/npm/fullcalendar@6.1.15/index.global.min.js',
  'https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore-compat.js',
  'https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js'
];

// Импорт Firebase для Cloud Messaging
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js');

// Конфигурация Firebase (должна совпадать с firebase-config.js)
const firebaseConfig = {
    apiKey: "AIzaSyDO51kaGWiPumsy6dB45bU9PjTUKJz7rtA",
    authDomain: "calendar-b87ed.firebaseapp.com",
    projectId: "calendar-b87ed",
    storageBucket: "calendar-b87ed.firebasestorage.app",
    messagingSenderId: "1034174840328",
    appId: "1:1034174840328:web:c9efffff44fbbe69d39bbd",
    measurementId: "G-2QVV1VDYEP"
};

// Инициализация Firebase
firebase.initializeApp(firebaseConfig);

// Инициализация Firebase Cloud Messaging
const messaging = firebase.messaging();

// Обработка фоновых сообщений от Firebase
// ПРИМЕЧАНИЕ: Отключено для предотвращения дублирования уведомлений
// Когда Firebase отправляет уведомление с полем "notification", оно автоматически показывается системой
// Если включить onBackgroundMessage, будет показываться два уведомления:
// 1. Системное уведомление от Firebase (правильное, с правильным текстом из payload.notification.body)
// 2. Уведомление от Service Worker (дубликат)
// 
// Решение: не обрабатывать сообщения с полем "notification", так как они уже показываются автоматически
messaging.onBackgroundMessage((payload) => {
    console.log('[FCM] Получено фоновое сообщение:', payload);
    
    // Если уведомление уже содержит поле "notification", Firebase покажет его автоматически
    // Не нужно показывать его еще раз через Service Worker
    if (payload.notification) {
        console.log('[FCM] Уведомление уже будет показано автоматически Firebase, пропускаем');
        return;
    }
    
    // Если нет поля "notification", но есть данные, можно показать уведомление вручную
    // Но в нашем случае все уведомления отправляются с полем "notification", так что этот код не выполнится
    const notificationTitle = payload.data?.title || 'Напоминание';
    const notificationOptions = {
        body: payload.data?.body || 'Не забудь о важном!',
        icon: BASE_PATH + '/icon-192.png',
        badge: BASE_PATH + '/icon-192.png',
        tag: payload.data?.tag || 'reminder',
        data: payload.data || {},
        requireInteraction: false,
        vibrate: [200, 100, 200],
        actions: [
            {
                action: 'open',
                title: 'Открыть'
            },
            {
                action: 'close',
                title: 'Закрыть'
            }
        ]
    };

    return self.registration.showNotification(notificationTitle, notificationOptions);
});

// Установка Service Worker
self.addEventListener('install', (event) => {
  console.log('[SW] Установка Service Worker, BASE_PATH:', BASE_PATH);
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Кэширование статических файлов');
        // Кэшируем файлы по одному, чтобы ошибка одного не блокировала остальные
        return Promise.allSettled(
          STATIC_CACHE_URLS.map(url => {
            const request = new Request(url, { cache: 'reload' });
            return fetch(request)
              .then(response => {
                if (response.ok) {
                  return cache.put(request, response);
                } else {
                  console.warn('[SW] Не удалось загрузить:', url, response.status);
                }
              })
              .catch(error => {
                console.warn('[SW] Ошибка загрузки:', url, error);
              });
          })
        );
      })
      .catch((error) => {
        console.error('[SW] Ошибка кэширования:', error);
      })
  );
  self.skipWaiting(); // Активируем сразу
});

// Активация Service Worker
self.addEventListener('activate', (event) => {
  console.log('[SW] Активация Service Worker');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          // Удаляем старые кэши
          if (cacheName !== CACHE_NAME && cacheName !== RUNTIME_CACHE) {
            console.log('[SW] Удаление старого кэша:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  return self.clients.claim(); // Берем контроль над всеми страницами
});

// Перехват запросов (стратегия: Network First, Fallback to Cache)
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Пропускаем запросы к Firebase и другим внешним API
  if (url.origin.includes('firebase') || url.origin.includes('googleapis')) {
    return; // Используем сеть напрямую
  }

  // Для статических файлов используем Network First с проверкой обновлений
  if (STATIC_CACHE_URLS.some(staticUrl => request.url.includes(staticUrl.split('/').pop()))) {
    event.respondWith(
      fetch(request, { cache: 'no-cache' })
        .then((response) => {
          // Всегда используем свежий ответ из сети
          if (response.status === 200) {
            // Обновляем кэш в фоне
            const responseToCache = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseToCache);
            });
          }
          return response;
        })
        .catch(() => {
          // Только если сеть недоступна, используем кэш
          return caches.match(request).then((cachedResponse) => {
            return cachedResponse;
          });
        })
    );
    return;
  }

  // Для HTML страниц используем Network First с проверкой обновлений
  if (request.mode === 'navigate' || (request.method === 'GET' && request.headers.get('accept').includes('text/html'))) {
    event.respondWith(
      fetch(request, { cache: 'no-cache' })
        .then((response) => {
          // Всегда используем свежий HTML из сети
          const responseToCache = response.clone();
          caches.open(RUNTIME_CACHE).then((cache) => {
            cache.put(request, responseToCache);
          });
          return response;
        })
        .catch(() => {
          // Если сеть недоступна, используем кэш
          return caches.match(request).then((cachedResponse) => {
            if (cachedResponse) {
              return cachedResponse;
            }
            // Если нет в кэше, возвращаем офлайн страницу
            return caches.match(BASE_PATH + '/index.html');
          });
        })
    );
    return;
  }

  // Для остальных запросов - Network First с проверкой обновлений
  event.respondWith(
    fetch(request, { cache: 'no-cache' })
      .then((response) => {
        // Всегда используем свежий ответ из сети
        if (response.status === 200) {
          const responseToCache = response.clone();
          caches.open(RUNTIME_CACHE).then((cache) => {
            cache.put(request, responseToCache);
          });
        }
        return response;
      })
      .catch(() => {
        // Используем кэш только при ошибке сети
        return caches.match(request);
      })
  );
});

// Обработка push-уведомлений
self.addEventListener('push', (event) => {
  console.log('[SW] Получено push-уведомление');
  
  let notificationData = {
    title: 'Напоминание',
    body: 'Не забудь о важном!',
    icon: BASE_PATH + '/icon-192.png',
    badge: BASE_PATH + '/icon-192.png',
    tag: 'reminder',
    requireInteraction: false,
    vibrate: [200, 100, 200]
  };

  if (event.data) {
    try {
      const data = event.data.json();
      notificationData = {
        title: data.title || notificationData.title,
        body: data.body || notificationData.body,
        icon: data.icon || notificationData.icon,
        badge: data.badge || notificationData.badge,
        tag: data.tag || notificationData.tag,
        data: data.data || {},
        requireInteraction: data.requireInteraction || false,
        vibrate: data.vibrate || [200, 100, 200]
      };
    } catch (e) {
      notificationData.body = event.data.text();
    }
  }

  event.waitUntil(
    self.registration.showNotification(notificationData.title, notificationData)
  );
});

// Обработка клика по уведомлению
self.addEventListener('notificationclick', (event) => {
  console.log('[SW] Клик по уведомлению');
  event.notification.close();

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // Если есть открытое окно, фокусируемся на нем
        for (let i = 0; i < clientList.length; i++) {
          const client = clientList[i];
          if (client.url && 'focus' in client) {
            return client.focus();
          }
        }
        // Если нет открытого окна, открываем новое
        if (clients.openWindow) {
          return clients.openWindow(BASE_PATH + '/');
        }
      })
  );
});

// Обработка сообщений от основного потока
self.addEventListener('message', (event) => {
  console.log('[SW] Получено сообщение:', event.data);
  
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  
  if (event.data && event.data.type === 'CACHE_URLS') {
    event.waitUntil(
      caches.open(CACHE_NAME).then((cache) => {
        return cache.addAll(event.data.urls);
      })
    );
  }
});
