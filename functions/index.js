const {onSchedule} = require('firebase-functions/v2/scheduler');
const admin = require('firebase-admin');
admin.initializeApp();

// Функция, которая запускается каждую минуту и проверяет напоминания
exports.checkAndSendReminders = onSchedule(
  {
    schedule: 'every 1 minutes',
    timeZone: 'Europe/Moscow', // ⚠️ ИЗМЕНИ НА СВОЙ ЧАСОВОЙ ПОЯС (например: 'Europe/Moscow', 'America/New_York')
    memory: '256MiB',
    maxInstances: 1
  },
  async (event) => {
    console.log('🦉 Проверка напоминаний...');
    
    const db = admin.firestore();
    
    // Получаем текущее время в часовом поясе Europe/Moscow
    // Важно: используем правильный часовой пояс для сравнения с временем напоминаний
    const timeZone = 'Europe/Moscow'; // ⚠️ ИЗМЕНИ НА СВОЙ ЧАСОВОЙ ПОЯС
    const now = new Date();
    
    // Конвертируем UTC время в локальное время указанного часового пояса
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      weekday: 'long'
    });
    
    const parts = formatter.formatToParts(now);
    const hour = parts.find(p => p.type === 'hour').value;
    const minute = parts.find(p => p.type === 'minute').value;
    const weekday = parts.find(p => p.type === 'weekday').value.toLowerCase();
    
    const currentTime = `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;
    
    // Маппинг дней недели
    const dayMap = {
      'sunday': 'sunday',
      'monday': 'monday',
      'tuesday': 'tuesday',
      'wednesday': 'wednesday',
      'thursday': 'thursday',
      'friday': 'friday',
      'saturday': 'saturday'
    };
    const currentDay = dayMap[weekday] || weekday;
    
    console.log(`⏰ UTC время: ${now.toISOString()}, ${timeZone} время: ${currentTime}, День: ${currentDay}`);
    
    try {
      // Получаем все календари
      const calendarsSnapshot = await db.collection('calendars').get();
      
      if (calendarsSnapshot.empty) {
        console.log('📭 Нет календарей');
        return null;
      }
      
      let totalSent = 0;
      
      // Проходим по всем календарям
      for (const calendarDoc of calendarsSnapshot.docs) {
        const calendarId = calendarDoc.id;
        const data = calendarDoc.data();
        
        console.log(`📅 Проверка календаря: ${calendarId}`);
        
        // Получаем FCM токены для этого календаря
        const fcmTokens = data.fcmTokens || [];
        
        console.log(`📱 Календарь ${calendarId}: найдено ${fcmTokens.length} FCM токенов`);
        
        if (fcmTokens.length === 0) {
          console.log(`⚠️ Календарь ${calendarId}: нет FCM токенов (пользователь не установил приложение или токен не сохранен)`);
          continue;
        }
        
        // Проверяем ежедневные ритуалы
        const daily = data.daily || [];
        for (const item of daily) {
          if (item.reminder && item.time === currentTime && !item.completed) {
            // Создаем сообщения для каждого токена
            const messages = fcmTokens.map(token => ({
              notification: {
                title: '🦉 Напоминание',
                body: `Ежедневный ритуал: ${item.name}`
              },
              token: token
            }));
            
            try {
              // Используем sendEach для отправки множественных уведомлений
              const response = await admin.messaging().sendEach(messages);
              const successCount = response.responses.filter(r => r.success).length;
              console.log(`✅ Ежедневный ритуал "${item.name}": отправлено ${successCount} уведомлений`);
              totalSent += successCount;
              
              const failureCount = response.responses.filter(r => !r.success).length;
              if (failureCount > 0) {
                console.log(`❌ Ошибок: ${failureCount}`);
                response.responses.forEach((resp, idx) => {
                  if (!resp.success) {
                    console.error(`  Ошибка для токена ${idx}:`, resp.error);
                  }
                });
              }
            } catch (error) {
              console.error('❌ Ошибка отправки ежедневного ритуала:', error);
            }
          }
        }
        
        // Проверяем задачи от Господина
        const master = data.master || [];
        for (const item of master) {
          if (item.reminder && item.time === currentTime && !item.completed) {
            // Создаем сообщения для каждого токена
            const messages = fcmTokens.map(token => ({
              notification: {
                title: '🦉 Напоминание',
                body: `Задача от Господина: ${item.name}`
              },
              token: token
            }));
            
            try {
              // Используем sendEach для отправки множественных уведомлений
              const response = await admin.messaging().sendEach(messages);
              const successCount = response.responses.filter(r => r.success).length;
              console.log(`✅ Задача от Господина "${item.name}": отправлено ${successCount} уведомлений`);
              totalSent += successCount;
              
              const failureCount = response.responses.filter(r => !r.success).length;
              if (failureCount > 0) {
                console.log(`❌ Ошибок: ${failureCount}`);
                response.responses.forEach((resp, idx) => {
                  if (!resp.success) {
                    console.error(`  Ошибка для токена ${idx}:`, resp.error);
                  }
                });
              }
            } catch (error) {
              console.error('❌ Ошибка отправки задачи от Господина:', error);
            }
          }
        }
        
        // Проверяем еженедельные ритуалы
        const weekly = data.weekly || [];
        for (const item of weekly) {
          if (item.reminder && item.day === currentDay && item.time === currentTime && !item.completed) {
            // Создаем сообщения для каждого токена
            const messages = fcmTokens.map(token => ({
              notification: {
                title: '🦉 Напоминание',
                body: `Еженедельный ритуал: ${item.name}`
              },
              token: token
            }));
            
            try {
              // Используем sendEach для отправки множественных уведомлений
              const response = await admin.messaging().sendEach(messages);
              const successCount = response.responses.filter(r => r.success).length;
              console.log(`✅ Еженедельный ритуал "${item.name}": отправлено ${successCount} уведомлений`);
              totalSent += successCount;
              
              const failureCount = response.responses.filter(r => !r.success).length;
              if (failureCount > 0) {
                console.log(`❌ Ошибок: ${failureCount}`);
                response.responses.forEach((resp, idx) => {
                  if (!resp.success) {
                    console.error(`  Ошибка для токена ${idx}:`, resp.error);
                  }
                });
              }
            } catch (error) {
              console.error('❌ Ошибка отправки еженедельного ритуала:', error);
            }
          }
        }
      }
      
      if (totalSent > 0) {
        console.log(`🎉 Всего отправлено уведомлений: ${totalSent}`);
      } else {
        console.log('✅ Проверка завершена, напоминаний нет');
      }
      
      return null;
    } catch (error) {
      console.error('❌ Критическая ошибка:', error);
      return null;
    }
  }
);
