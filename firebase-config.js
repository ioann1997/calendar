// Конфигурация Firebase
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
const db = firebase.firestore();

// Включаем офлайн-режим с IndexedDB persistence для лучшей работы без интернета
try {
    db.enablePersistence({
        synchronizeTabs: true
    }).catch((err) => {
        // Игнорируем ошибки, если persistence уже включен или не поддерживается
        if (err.code !== 'failed-precondition' && err.code !== 'unimplemented') {
            console.warn('Не удалось включить офлайн-режим Firestore:', err);
        }
    });
} catch (e) {
    // Игнорируем ошибки инициализации persistence
}

