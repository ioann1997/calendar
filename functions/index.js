const {onSchedule} = require('firebase-functions/v2/scheduler');
const admin = require('firebase-admin');
admin.initializeApp();

// Функция для генерации случайного сообщения напоминания
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

// Функция для генерации случайного ежедневного сообщения в 19:00
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

// Функция для удаления недействительных токенов из Firestore
async function removeInvalidTokens(db, calendarId, invalidTokens) {
  if (invalidTokens.length === 0) return;
  
  try {
    const calendarRef = db.collection('calendars').doc(calendarId);
    await calendarRef.update({
      fcmTokens: admin.firestore.FieldValue.arrayRemove(...invalidTokens)
    });
    console.log(`🗑️ Удалено ${invalidTokens.length} недействительных токенов из календаря ${calendarId}`);
  } catch (error) {
    console.error(`❌ Ошибка удаления недействительных токенов:`, error);
  }
}

// Функция для обработки ответов от sendEach и удаления недействительных токенов
function processSendResponse(response, fcmTokens, calendarId, db) {
  const invalidTokens = [];
  
  response.responses.forEach((resp, idx) => {
    if (!resp.success) {
      const errorCode = resp.error?.code;
      // Проверяем, является ли ошибка признаком недействительного токена
      if (errorCode === 'messaging/registration-token-not-registered' || 
          errorCode === 'messaging/invalid-registration-token' ||
          errorCode === 'messaging/invalid-argument') {
        invalidTokens.push(fcmTokens[idx]);
        console.log(`⚠️ Токен ${idx} недействителен и будет удален: ${errorCode}`);
      } else {
        console.error(`  Ошибка для токена ${idx}:`, resp.error);
      }
    }
  });
  
  // Удаляем недействительные токены из Firestore
  if (invalidTokens.length > 0) {
    removeInvalidTokens(db, calendarId, invalidTokens);
  }
  
  return {
    successCount: response.responses.filter(r => r.success).length,
    failureCount: response.responses.filter(r => !r.success).length,
    invalidTokensCount: invalidTokens.length
  };
}

// Функция, которая запускается каждую минуту и проверяет напоминания
exports.checkAndSendReminders = onSchedule(
  {
    schedule: 'every 1 minutes',
    timeZone: 'Europe/Moscow', // ⚠️ ИЗМЕНИ НА СВОЙ ЧАСОВОЙ ПОЯС (например: 'Europe/Moscow', 'America/New_York')
    memory: '256MiB',
    maxInstances: 1,
    region: 'us-central1' // Явно указываем регион
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
    
    // Дополнительная проверка для отладки: логируем точное время
    console.log(`🕐 Детали времени: hour="${hour}", minute="${minute}", currentTime="${currentTime}"`);
    
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
        
        // Проверяем ежедневные ритуалы - каждый день в назначенное время
        const daily = data.daily || [];
        for (const item of daily) {
          if (item.reminder && item.time === currentTime) {
            const reminderMessage = getRandomReminderMessage(item.name);
            const messages = fcmTokens.map(token => ({
              notification: {
                title: '🦉 Напоминание',
                body: reminderMessage
              },
              token: token
            }));
            
            try {
              const response = await admin.messaging().sendEach(messages);
              const result = processSendResponse(response, fcmTokens, calendarId, db);
              console.log(`✅ Ежедневный ритуал "${item.name}": отправлено ${result.successCount} уведомлений`);
              if (result.invalidTokensCount > 0) {
                console.log(`🗑️ Удалено ${result.invalidTokensCount} недействительных токенов`);
              }
              totalSent += result.successCount;
            } catch (error) {
              console.error('❌ Ошибка отправки ежедневного ритуала:', error);
            }
          }
        }
        
        // Проверяем задачи от Хозяина - одно уведомление в день создания задачи
        const master = data.master || [];
        const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
        for (const item of master) {
          if (item.reminder && item.createdDate === today && item.time === currentTime) {
            const reminderMessage = getRandomReminderMessage(item.name);
            const messages = fcmTokens.map(token => ({
              notification: {
                title: '🦉 Напоминание',
                body: reminderMessage
              },
              token: token
            }));
            
            try {
              const response = await admin.messaging().sendEach(messages);
              const result = processSendResponse(response, fcmTokens, calendarId, db);
              console.log(`✅ Задача от Хозяина "${item.name}": отправлено ${result.successCount} уведомлений`);
              if (result.invalidTokensCount > 0) {
                console.log(`🗑️ Удалено ${result.invalidTokensCount} недействительных токенов`);
              }
              totalSent += result.successCount;
            } catch (error) {
              console.error('❌ Ошибка отправки задачи от Хозяина:', error);
            }
          }
        }
        
        // Проверяем еженедельные ритуалы - в указанное время и день недели
        const weekly = data.weekly || [];
        for (const item of weekly) {
          if (item.reminder && item.day === currentDay && item.time === currentTime) {
            const reminderMessage = getRandomReminderMessage(item.name);
            const messages = fcmTokens.map(token => ({
              notification: {
                title: '🦉 Напоминание',
                body: reminderMessage
              },
              token: token
            }));
            
            try {
              const response = await admin.messaging().sendEach(messages);
              const result = processSendResponse(response, fcmTokens, calendarId, db);
              console.log(`✅ Еженедельный ритуал "${item.name}": отправлено ${result.successCount} уведомлений`);
              if (result.invalidTokensCount > 0) {
                console.log(`🗑️ Удалено ${result.invalidTokensCount} недействительных токенов`);
              }
              totalSent += result.successCount;
            } catch (error) {
              console.error('❌ Ошибка отправки еженедельного ритуала:', error);
            }
          }
        }
        
        // Ежедневное уведомление в 19:00 для всех пользователей PWA
        // Проверяем время более надежно: час = 19 и минута = 0
        const hourInt = parseInt(hour, 10);
        const minuteInt = parseInt(minute, 10);
        const is7PM = hourInt === 19 && minuteInt === 0;
        
        console.log(`🔍 Проверка времени для ежедневного уведомления: currentTime="${currentTime}", hour=${hourInt}, minute=${minuteInt}, is7PM=${is7PM}`);
        
        if (is7PM || currentTime === '19:00') {
          console.log(`✅ Время 19:00 обнаружено для календаря ${calendarId}, проверяем дату последней отправки...`);
          // Проверяем, не отправляли ли уже сегодня уведомление в 18:00
          const last11AMDate = data.last11AMNotificationDate;
          const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
          
          console.log(`📅 Дата последней отправки: ${last11AMDate}, сегодня: ${today}`);
          console.log(`📊 Количество токенов для отправки: ${fcmTokens.length}`);
          
          if (!last11AMDate || last11AMDate !== today) {
            if (fcmTokens.length === 0) {
              console.log(`⚠️ Нет токенов для отправки ежедневного уведомления 19:00`);
            } else {
              console.log(`🚀 Отправка ежедневного уведомления 19:00 для календаря ${calendarId}...`);
              const dailyMessage = getDaily11AMMessage();
              console.log(`💬 Сообщение: "${dailyMessage}"`);
              
              const messages = fcmTokens.map(token => ({
                notification: {
                  title: '💝 Твоё напоминание',
                  body: dailyMessage
                },
                token: token
              }));
              
              console.log(`📤 Подготовлено ${messages.length} сообщений для отправки`);
              
              try {
                // Используем sendEach для отправки множественных уведомлений
                const response = await admin.messaging().sendEach(messages);
                const result = processSendResponse(response, fcmTokens, calendarId, db);
                console.log(`✅ Ежедневное уведомление 19:00: отправлено ${result.successCount} уведомлений`);
                if (result.failureCount > 0) {
                  console.log(`⚠️ Не удалось отправить ${result.failureCount} уведомлений`);
                }
                if (result.invalidTokensCount > 0) {
                  console.log(`🗑️ Удалено ${result.invalidTokensCount} недействительных токенов`);
                }
                
                // Сохраняем дату последней отправки, чтобы не дублировать в течение дня
                await calendarDoc.ref.update({
                  last11AMNotificationDate: today
                });
                
                console.log(`💾 Дата отправки сохранена: ${today}`);
                totalSent += result.successCount;
              } catch (error) {
                console.error('❌ Ошибка отправки ежедневного уведомления 19:00:', error);
                console.error('❌ Детали ошибки:', error.message, error.stack);
              }
            }
          } else {
            console.log(`⏭️ Ежедневное уведомление 19:00 уже отправлено сегодня для календаря ${calendarId} (${last11AMDate})`);
          }
        } else {
          // Логируем только если близко к 19:00 для отладки
          const hour = parseInt(currentTime.split(':')[0]);
          const minute = parseInt(currentTime.split(':')[1]);
          if (hour === 19 && minute >= 0 && minute <= 2) {
            console.log(`⏰ Время близко к 19:00, но не точно: ${currentTime}`);
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
