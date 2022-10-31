const {Telegraf} = require('telegraf');
const {Markup} = require('telegraf');

const cfg = require('./resources/config');
const strings = require('./resources/strings');
const otkrivator = require('./helpers/otkrivator');
const jitsi = require('./helpers/jitsi');
const bells = require('./helpers/bells');
const myself = require('./helpers/myself');
const activitiesModel = require('./models/activities');
const report = require('./helpers/report-generator');
const bd = require('./models/botBd');
const userModel = require('./models/users');
const logs = require('./models/logs');
const rights = require('./helpers/cowSuperPowers');
const logsHelper = require('./helpers/logs');
const {keyboardConstants, commands} = require("./resources/strings");
const {FSM_STATE} = require("./models/users");
const mySelfModel = require('./models/mySelf');
const {getViewText} = require("./helpers/myself");
const bot = new Telegraf(cfg.TG_TOKEN);

/**
 * Handle document uploads.
 */
async function handleDocument(ctx) {
    const userState = await userModel.getState(ctx.userId);
    let newState = userModel.FSM_STATE.DEFAULT;
    // await ctx.reply(ctx.message.document.file_id);
    try {
        if (userState === userModel.FSM_STATE.REPORT_GENERATE) {
            const fileId = ctx.message.document.file_id;
            //не хотел подключать API телеграмма к хэлперам, по этому подготавливаю
            //файл к загрузке в роутере
            const telegramFileResponse = await ctx.telegram.getFile(fileId);
            const pathToArchiveWithReports = await report.generate(ctx.userId, telegramFileResponse);
            await userModel.setState(ctx.userId, newState);
            console.log(ctx.userId, `[${userState}] -> [${newState}]`);
            await ctx.replyWithDocument({source: pathToArchiveWithReports});
        }
    } catch (err) {
        await ctx.reply(err.message);
    } finally {
        await userModel.setState(ctx.userId, newState);
        console.log(ctx.userId, `[${userState}] -> [${newState}]`);
        await report.garbageCollector(ctx.userId);
    }
}

async function handleText(ctx) {
    const userState = await userModel.getState(ctx.userId);
    console.log(userState);
    const messageText = ctx.message.text;
    try {
        switch (userState) {
        case userModel.FSM_STATE.USER_MANAGEMENT_SELECT_USER:
            const newState = userModel.FSM_STATE.USER_MANAGEMENT_SELECT_OPERATION;
            const objectID = ctx.message.text.trim();
            await activitiesModel.add(ctx.userId, objectID);
            await userModel.setState(ctx.userId, newState);
            console.log(ctx.userId, `[${userState}] -> [${newState}]`);
            await rightsMenu(ctx);
            break;

        case userModel.FSM_STATE.USER_MANAGEMENT_SET_NOTE:
            const activity = await activitiesModel.find(ctx.userId);
            if (!activity) {
                const newState = userModel.FSM_STATE.DEFAULT;
                await userModel.setState(ctx.userId, newState);
                console.log(ctx.userId, `[${userState}] -> [${newState}]`);
                await ctx.reply("ОШИБКА: Не выбран пользователь");
            } else {
                const newState = userModel.FSM_STATE.DEFAULT;
                await userModel.setState(ctx.userId, newState);
                console.log(ctx.userId, `[${userState}] -> [${newState}]`);
                await rights.changeUserProperty(activity.objectID,
                                                'note',
                                                ctx.message.text.trim());
                await ctx.reply("Заметка повешена на пользователя");
            }
            break;
        case userModel.FSM_STATE.TASKS:
            switch (messageText) {
            case keyboardConstants.TASKS_BACK:
                await ctx.reply("Возвращаемся назад", strings.mainKeyboard.forAdmins);
                await userModel.setState(ctx.userId, FSM_STATE.DEFAULT);
                break;
            case keyboardConstants.TASKS_NEW:
                await ctx.reply("Введите название новой задачи", strings.cancelKeyboard);
                await userModel.setState(ctx.userId, FSM_STATE.TASK_ADD);
                break;
            case keyboardConstants.TASKS_GET_FILE:
                await ctx.reply("Ваш отчётик");
                await replyMyselfFile(ctx.userId, ctx);
                break;
            }
            break;
        case userModel.FSM_STATE.TASK_ADD:
            if (messageText === strings.keyboardConstants.CANCEL) {
                await ctx.reply("Отмена так отмена", strings.tasksKeyboard);
                await userModel.setState(ctx.userId, FSM_STATE.TASKS);
            } else {
                await ctx.reply(await myself.new(ctx.userId,
                                                 ctx.userName,
                                                 ctx.message.text.trim()), strings.tasksKeyboard);
                await userModel.setState(ctx.userId, FSM_STATE.TASKS);
                await mySelfMenu(ctx);
            }
            break;
        case userModel.FSM_STATE.TASK_CHANGE_STATE:
            await activitiesModel.add(ctx.userId, ctx.message.text.trim());
            await userModel.setState(ctx.userId, userModel.FSM_STATE.DEFAULT);
            break;
        case userModel.FSM_STATE.DEFAULT:
            switch (messageText) {
            case keyboardConstants.MYSELF:
                await userModel.setState(ctx.userId, userModel.FSM_STATE.TASKS);
                await mySelfMenu(ctx);
            }
            break;


        default:

            if (ctx.message.text.startsWith(strings.commands.MYSELF_QUICK_NEW)) {
                await ctx.reply(await myself.new(ctx.userId, ctx.userName, ctx.message.text.slice(2).trim()));
            } else {
                if (ctx.message.text === strings.textConstants.CONFIRM_DELETE) {
                    await ctx.reply(await myself.clear(ctx.userId));
                } else {
                    await hello(ctx);
                }
            }
        }
    } catch (err) {
        await ctx.reply(err.message);
    }
}

async function handleError(err) {
    console.log("Все паламалась!!!");
    console.log(err.message);
}

/**
 * Установка значений ШВ, имени пользователя.
 */
async function setUserData(ctx, next) {
    ctx.userId = ctx.from.id.toString();
    ctx.userName = ctx.from.first_name;
    await next();
}

async function createUser(ctx, cfg) {
    if (ctx.userId == cfg.TG_ADMIN_ID) {
        console.log("Creating the system administrator with ID ",
                    ctx.userId);
        ctx.status = "admin";
        ctx.opener = "true";
    } else {
        ctx.status = "student";
        ctx.opener = "false";
    }
    await userModel.newUser(
        {
            userId: ctx.userId,
            username: ctx.from.username,
            firstname: ctx.from.first_name,
            lastname: ctx.from.last_name,
            status: ctx.status,
            opener: ctx.opener
        });
}

async function updateUser(ctx, user, cfg) {
    ctx.status = user.status;
    ctx.note = user.note;
    ctx.opener = (user.status !== 'admin') ? user.opener : true;

    if (user.username === "null") {
        await userModel.setUserInfo(
            {
                userId: ctx.userId,
                username: ctx.from.username,
                firstname: ctx.from.first_name,
                lastname: ctx.from.last_name
            });
    }
}

bd.connect();

bot.use(setUserData);

/**
 * Каждый раз проверка, что пользователь есть в базе данных
 * и устанавливает в обхект ctx дополнительные сведения о пользователе.
 * Докидывает пользователя в базу, если его нет.
 */
bot.use(async (ctx, next) => {
    const user = await userModel.get(ctx.userId);
    if (!user) {
        await createUser(ctx, cfg);
    } else {
        await updateUser(ctx, user, cfg);
    }
    await next();
});

/**
 * Логирование запросов
 */
bot.use(async (ctx, next) => {
    const recordForLog = {
        userId: ctx.userId,
        username: ctx.from.username,
        realname: ctx.from.first_name + " " + ctx.from.last_name,
        note: ctx.note,
        time: new Date(),
    };
    switch (ctx.updateType) {
        case "message":
            if (ctx.updateSubTypes[0] === 'document') {
                recordForLog.messageType = 'document';
                recordForLog.message = 'document';
            } else {
                recordForLog.messageType = 'message';
                recordForLog.message = ctx.message.text;
            }
            break;
        case "callback_query":
            recordForLog.messageType = 'callback_query';
            recordForLog.message = ctx.update.callback_query.data;
            break;
        default:
            break;
    }
    ctx.messageType = recordForLog.messageType;
    ctx.request = recordForLog.message;
    await logs.addLog(recordForLog);
    await next();
});

/**
 * отсекаю пользователям действия, на которые у них нет прав
 */
bot.use(async (ctx, next) => {
    if (rights.hasAccess(ctx.status, ctx.messageType, ctx.request, ctx.opener)) {
        await next();
    } else {
        await ctx.reply("Нет доступа");
    }

});

/**
 * скорость выполнения запросов. По умолчанию не используется
 */
bot.use(async (ctx, next) => {
    const start = new Date();
    await next();
    const ms = new Date() - start;
    //await  ctx.reply(`Запрос выполнен за ${ms} мс`);
});

// ######## Middleware ###########

/**
 * выводит приветсвенное сообщение и основную клавиатуру
 * @param ctx
 * @returns {Promise<void>}
 */
async function hello(ctx) {
    let welcomeMessage = 'Добро пожаловать, ' + ctx.userName + '\n';
    let mainKeyboard;

    switch (ctx.status) {
        case 'student':
            welcomeMessage += strings.welcomeMessage.forStudents;
            mainKeyboard = strings.mainKeyboard.forStudents;
            break;
        case 'admin':
            welcomeMessage += strings.welcomeMessage.forAdmins;
            mainKeyboard = strings.mainKeyboard.forAdmins;
            break;
        case 'teacher':
            welcomeMessage += strings.welcomeMessage.forTeachers;
            mainKeyboard = strings.mainKeyboard.forTeachers;
            break;
    }

    await ctx.reply(welcomeMessage, mainKeyboard);
}

/**
 * Выводит меню самооценки
 * @param ctx
 * @returns {Promise<void>}
 */
async function mySelfMenu(ctx) {
    const tasks = await myself.list(ctx.userId, ctx.userName);
    if (tasks.length) {
        await ctx.reply(
            'Задачи:',
            Markup.inlineKeyboard(tasks.map(task => {
                return [
                    Markup.callbackButton(task.viewText, strings.commands.TASK_CHANGE_STATUS + " " + task.affair)
                ];
            })).extra()
        );
    } else await ctx.reply("Список задач пуст");

    await ctx.reply('Выберите действие:', strings.tasksKeyboard);
}

/**
 * Выводит меню генерации отчета по практикам
 * @param ctx
 * @returns {Promise<void>}
 */
async function reportMenu(ctx) {
    const userState = await userModel.getState(ctx.userId);
    const newState = userModel.FSM_STATE.REPORT_START;
    await userModel.setState(ctx.userId, newState);
    console.log(ctx.userId, `[${userState}] -> [${newState}]`);

    await ctx.reply('Меню генерации отчетов по практике:',
        Markup.inlineKeyboard(
            [
                [Markup.callbackButton(strings.keyboardConstants.REPORTS_MAN, strings.commands.REPORTS_MAN)],
                [Markup.callbackButton(strings.keyboardConstants.REPORTS_TEMPLATE, strings.commands.REPORTS_TEMPLATE)],
                [Markup.callbackButton(strings.keyboardConstants.REPORTS_GENERATE, strings.commands.REPORTS_GENERATE)],
            ]).extra());
}

/**
 * Выводит меню генерации пользователей.
 * Админ может выбрать пользователя для работы, в таком случае, начинает выводиться информация о пользователе
 * id пользователя, который в работе
 * @param ctx
 * @returns {Promise<void>}
 */
async function rightsMenu(ctx) {
    const userState = await userModel.getState(ctx.userId);
    const activity = await activitiesModel.find(ctx.userId);
    const message = ['Меню управления пользователями: '];
    const keyboard = [[Markup.callbackButton(strings.keyboardConstants.RIGHTS_USER_CHOISE,
        strings.commands.RIGHTS_USER_CHOISE)]];
    if (!activity) {
        message.push('Не выбран пользователь для изменения прав доступа');
    } else {
        message.push(await rights.getUserInfo(activity.objectID));
        keyboard.push([Markup.callbackButton(strings.keyboardConstants.RIGHTS_USER_SET_STATUS,
                strings.commands.RIGHTS_USER_SET_STATUS)],
            [Markup.callbackButton(strings.keyboardConstants.RIGHTS_USER_SET_OPENER,
                strings.commands.RIGHTS_USER_SET_OPENER)],
            [Markup.callbackButton(strings.keyboardConstants.RIGHTS_USER_SET_NOTE,
                strings.commands.RIGHTS_USER_SET_NOTE)],
            [Markup.callbackButton(strings.keyboardConstants.RIGHTS_USER_CLEAR,
                strings.commands.RIGHTS_USER_CLEAR)]);
    }

    await ctx.reply(message.join('\n'), Markup.inlineKeyboard(
        keyboard).extra());
}

/**
 * Приветствует и выставляет состояние в default
 */
bot.start(async (ctx) => {
    await userModel.setState(ctx.userId, userModel.FSM_STATE.DEFAULT);
    await hello(ctx);
});

/**
 * Просто приветствует
 */
bot.help(async (ctx) => {
    await hello(ctx);
});

/**
 * Выводит telegramId пользователя
 */
bot.command('getId', async (ctx) => {
    await ctx.reply(ctx.userId);
});

/**
 * Выводит список всех админов
 */
bot.command('admins', async (ctx) => {
    await ctx.reply(await rights.getAdmins());
});

/**
 * Выгружает csv файла логов пользователей и использования системы,
 * Прибирает мусор
 */
bot.command('logs', async (ctx) => {
    try {
        const pathsToLogs = await logsHelper.getLogs(ctx.userId);
        await ctx.replyWithDocument({source: pathsToLogs[0]});
        await ctx.replyWithDocument({source: pathsToLogs[1]});
        await logsHelper.garbageCollector(pathsToLogs);
    } catch (err) {
        await ctx.reply(err.message);
    }
});

/**
 * Команда на открытие двери ВЦ
 */
bot.hears(strings.keyboardConstants.VC, async (ctx) => {
    await ctx.reply(await otkrivator.openItPark());
});

/**
 * Команда на получение информации о расписании звонков
 */
bot.hears(strings.keyboardConstants.BELLS, async (ctx) => {
    await ctx.replyWithHTML(await bells.info());
});

/**
 * Команда на статус Jitsi
 */
bot.hears(strings.keyboardConstants.JITSY, async (ctx) => {
    await ctx.reply(ctx.userName + ', ' + await jitsi.health());
});

/**
 * Включает и выключает режим вывода дат в листах самооценки
 */
bot.command('showDate', async (ctx) => {
    try {
        const show = await userModel.get(ctx.userId);
        const queryRes = await userModel.dateDisplay(ctx.userId, !show.showDate);
        if (queryRes) {
            await ctx.reply(`Вывод дат в листах самооценки ${(!show.showDate) ? 'включен' : 'выключен'}`);
        } else {
            await ctx.reply("Твоих данных нет в базе, дружочек");
        }
    } catch (err) {
        await ctx.reply(err.message);
    }
});

/**
 * Команда на вывод меню управления правами пользователей
 */
bot.hears(strings.keyboardConstants.RIGHTS, async (ctx) => {
    await rightsMenu(ctx);
});

/**
 * Команда на вывод меню генерации отчетов
 */
bot.hears(strings.keyboardConstants.REPORTS, async (ctx) => {
    await reportMenu(ctx);
});

/**
 * Если пользователь загрузил файл- проверяю намерение сгенерировать отчет
 */
bot.on('document', handleDocument);

/**
 * Выполняется если бот получил произвольный текст.
 * Проверка не было ли предложения ввести дело,
 * Проверка не было ли быстрой команды на ввод дела
 * Проверка на очистку листа сомооценки
 */
bot.on('text', handleText);

//обработка команд с inline клавиатуры

/**
 * Роутер нажатия кнопок inline клавиатуры
 */
bot.on('callback_query', async (ctx) => {
    const callbackQuery = ctx.callbackQuery.data;

    await mySelfMenuCallback(ctx, callbackQuery);
    await reportMenuCallback(ctx, callbackQuery);
    await rightsMenuCallback(ctx, callbackQuery);
});

/**
 * Реакция на нажатие кнопок в меню управления пользователем
 * @param ctx
 * @param callbackQuery
 * @returns {Promise<void>}
 */
async function rightsMenuCallback(ctx, callbackQuery) {
    const userState = await userModel.getState(ctx.userId);
    let newState = false;
    let activity = false;
    try {
        switch (callbackQuery) {
            case strings.commands.RIGHTS_USER_CHOISE:
                newState = userModel.FSM_STATE.USER_MANAGEMENT_SELECT_USER;
                await userModel.setState(ctx.userId, newState);
                let userList = await userModel.getAllUsers();
                console.log(ctx.userId, `[${userState}] -> [${newState}]`);
                await ctx.reply("Пользователи в системе:\n"
                    + userList.map((user) => {
                        const id = user.userId;
                        const username = user.username;
                        const firstname = user.firstname;
                        const lastname = user.lastname;
                        const fullname = `${firstname} ${lastname}`;
                        const status = user.status;
                        return `- ${id}: @${username} (${fullname}) — ${status}`;
                    }).join('\n'));
                await ctx.reply("Введи id пользователя, дружочек");
                break;
            case strings.commands.RIGHTS_USER_CLEAR:
                activity = await activitiesModel.find(ctx.userId);
                newState = userModel.FSM_STATE.DEFAULT;
                await activitiesModel.remove(activity.subjectID,
                    activity.objectID);
                await userModel.setState(ctx.userId, newState);
                console.log(ctx.userId, `[${userState}] -> [${newState}]`);
                await ctx.reply(`Редактирование пользователя ${activity.objectID} завершено`);
                break;
            case strings.commands.RIGHTS_USER_SET_STATUS:
                activity = await activitiesModel.find(ctx.userId);
                if (!activity) {
                    ctx.reply("ОШИБКА: Не выбран пользователь");
                } else {
                    newState = userModel.FSM_STATE.DEFAULT;
                    await userModel.setState(ctx.userId, newState);
                    console.log(ctx.userId, `[${userState}] -> [${newState}]`);
                    await rights.changeUserProperty(activity.objectID,
                        'status');
                    await ctx.reply("Статус изменен");
                }
                break;
            case strings.commands.RIGHTS_USER_SET_OPENER:
                activity = await activitiesModel.find(ctx.userId);
                if (!activity) {
                    ctx.reply("ОШИБКА: Не выбран пользователь");
                } else {
                    newState = userModel.FSM_STATE.DEFAULT;
                    await userModel.setState(ctx.userId, newState);
                    console.log(ctx.userId, `[${userState}] -> [${newState}]`);
                    await rights.changeUserProperty(activity.objectID,
                        'opener');
                    await ctx.reply("Права на замок изменены");
                }
                break;
            case strings.commands.RIGHTS_USER_SET_NOTE:
                activity = await activitiesModel.find(ctx.userId);
                if (!activity) {
                    ctx.reply("ОШИБКА: Не выбран пользователь");
                } else {
                    newState = userModel.FSM_STATE.USER_MANAGEMENT_SET_NOTE;
                    await userModel.setState(ctx.userId, newState);
                    console.log(ctx.userId, `[${userState}] -> [${newState}]`);
                    await ctx.reply("Введи новую заметку о пользователе, дружочек");
                }
                break;
        }
    } catch (err) {
        await ctx.reply(err.message);
    }
}

/**
 * Реакция на нажатие кнопок меню генерации отчетов
 * @param ctx
 * @param callbackQuery
 * @returns {Promise<void>}
 */
async function reportMenuCallback(ctx, callbackQuery) {
    const userState = await userModel.getState(ctx.userId);
    let newState = userModel.FSM_STATE.DEFAULT;
    try {
        switch (callbackQuery) {
            case strings.commands.REPORTS_MAN:
                await ctx.replyWithDocument({source: report.manual()});
                break;
            case strings.commands.REPORTS_TEMPLATE:
                await ctx.replyWithDocument({source: report.template()});
                break;
            case strings.commands.REPORTS_GENERATE:
                newState = userModel.FSM_STATE.REPORT_GENERATE;
                await userModel.setState(ctx.userId, newState);
                console.log(ctx.userId, `[${userState}] -> [${newState}]`);
                await ctx.reply("Дай мне заполненный шаблон, дружочек");
                break;
        }
    } catch (err) {
        await userModel.setState(ctx.userId, newState);
        console.log(ctx.userId, `[${userState}] -> [${newState}]`);
        await ctx.reply(err.message);
    }
}

/**
 * Реакция на нажатие кнопок меню самооценки
 * @param ctx
 * @param callbackQuery
 * @returns {Promise<void>}
 */
async function mySelfMenuCallback(ctx, callbackQuery) {
    try {
        if (callbackQuery.startsWith(strings.commands.TASK_CHANGE_STATUS)) {
            const taskName = callbackQuery.split(" ").slice(1).join(" ");
            await myself.changeState(ctx.userId, taskName);

            //update keyboard
            const tasks = await myself.list(ctx.userId, ctx.userName);
            await ctx.editMessageReplyMarkup(
                Markup.inlineKeyboard(tasks.map(task => {
                    return [Markup.callbackButton(task.viewText, strings.commands.TASK_CHANGE_STATUS + " " + task.affair)];
                }))
            );
        }
    } catch (err) {
        await ctx.reply(err.message);
    }
}
bot.action(new RegExp(`${strings.commands.TASK_CHANGE_STATUS}`), ctx => {

})
/**
 * Отдает в чат лист самооценки и прибирает мусор за генератором файла
 * @param userId
 * @param ctx
 * @returns {Promise<unknown>}
 */
async function replyMyselfFile(userId, ctx) {
    return new Promise(async (resolve, reject) => {
        try {
            const myselfFile = await myself.getMyselfFile(userId);
            await ctx.replyWithDocument({source: myselfFile});
            resolve();
        } catch (err) {
            reject(new Error(err.message));
        } finally {
            await userModel.setState(ctx.userId, FSM_STATE.TASKS);
            await myself.garbageCollector(userId); //сборка мусора
        }
    });
}

bot.launch();

/**
 * Перехват необработанных ошибок
 */
process.on("uncaughtException", handleError);

/// index.js ends here.
