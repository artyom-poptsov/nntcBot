const fs = require('fs');
const child_process = require('child_process');
const modelMyself = require('../models/mySelf');
const modelUser = require('../models/users');

/**
 * Выводит список выполненных дел
 * @param userId
 * @param userName
 * @returns {Promise<Array>}
 */
module.exports.list = async (userId, userName) => {
    return new Promise( async (resolve, reject)=>{
        let toDoList = [];
        try {
            const queryMyself = await modelMyself.get(userId);
            if (!queryMyself) {
                resolve(toDoList);
            } else {
                toDoList = await botDecorator(userId, queryMyself.affairs);
                resolve(toDoList);
            }
        } catch (err) {
            console.log("affairs list error", err);
            reject(new Error('Не могу показать твой лист, дружочек =('));
        }
    });
};

/**
 * Добавляет новое дело в файл и созадет его, если файла нет.
 * @param userId
 * @param userName
 * @param affair
 * @returns {Promise<unknown>}
 */
module.exports.new = async (userId, userName, affair) => {
    return new Promise( async (resolve, reject)=>{
        try {
            await modelMyself.addAffair(userId, affair);
            resolve(userName + ", твое дело учтено!");
        }catch (err) {
            reject(new Error(err.message));
        }
    });
};

/**
 * Удаляет файл со списком дел
 * @param userId
 * @returns {Promise<unknown>}
 */
module.exports.clear =  async (userId) => { //просто удаляет файл
    return new Promise( async (resolve, reject)=> {
        try{
            await modelMyself.clearAffair(userId);
            resolve("Нет у вас больше дел");
        }catch (err) {
            reject(new Error(err.message))
        }
    });
}

module.exports.changeState = async (userId, taskId) => {
    return new Promise( async (resolve, reject) => {
        try {
            await modelMyself.changeState(userId, taskId);
            resolve("Сделано");
        } catch (err) {
            reject(new Error(err.message));
        }
    });
};

/**
 * Генерирует файл с листом самооценки
 * @param userId
 * @returns {Promise<unknown>}
 */
module.exports.getMyselfFile = async (userId) => { //находимся в корне проекта
    return new Promise(async (resolve, reject) => {
        const templateDirectory = `tmp/${userId}_self`; //здесь разобраный шаблон одт tmpPath
        const templateFile = `./${templateDirectory}/content.xml`; //файл с текстовым содержимым одт tmpFile
        let toDoList = [];  //массив, где я формирую будущую верстку

        try {
            await mkDir(templateDirectory);
            await cpTemplate(templateDirectory);
            const myselfData = await modelMyself.get(userId);

            toDoList = await fileDecorator(userId, myselfData.affairs);   //декорирую под запись в файл
            toDoList.push("</office:text></office:body></office:document-content>");

            let templateFileData = await readFile(templateFile, "Файл шаблона не был создан");
            templateFileData += toDoList.join("");

            await writeFile(templateFile, templateFileData, "Не могу создать файл");
        }
        catch (err) {
            reject(new Error(err.message));
        }
        child_process.exec(`cd ${templateDirectory}; zip -0 -r ../myself_${userId}.odt *`, (err) =>{ //упаковываю одт
            if(err){
                reject(new Error(err.message))
            }
                resolve(`tmp/myself_${userId}.odt`);
        });
    });
}

/**
 * Сборщик мусора после генерации листа самооценок
 * @param userId
 * @returns {Promise<void>}
 */
module.exports.garbageCollector = async (userId) => {
    const tmpPath = `tmp/${userId}_self`;
    const tmpFile = `tmp/myself_${userId}.odt`;
    child_process.exec(`rm -rf ${tmpPath} ${tmpFile}`,(err) => {
        if(err){
            throw new Error("не могу собрать мусор");
        }
    });
}


/**
 * Декоратор вывода листа самооценок в бота
 * @param userId
 * @param affairs
 * @returns {Promise<*>}
 */
async function botDecorator(userId, affairs){
    try{
        const user = await modelUser.get(userId);
        let i = 0;
        return affairs.map(affair => {
            const affairDateString = user.showDate ? '"' + affair.date + '" —' : '';
            const isDoneMark = affair.isDone ? "✅" : "🔲";
            affair.viewText = `${isDoneMark} ${i++} — ${affairDateString} ${affair.affair}`;
            return affair;
        });
    }catch (err) {
        throw err;
    }
}

/**
 * Декоратор вывода листа самооценок в файл
 * @param userId
 * @param affairs
 * @returns {Promise<*>}
 */
async function fileDecorator(userId, affairs){
    try{
        const showDate = await modelUser.get(userId);
        let i = 1;
        return affairs.map((affair) => {
            return `<text:p text:style-name="P${i++}">- ${showDate.showDate ?'"' 
                + affair.date + '"' : ''} ${affair.affair}</text:p>`; //одтшная верстка
        });
    }catch (err) {
        throw err;
    }
}


/**
 * Создать папку
 * @param path
 * @returns {Promise<unknown>}
 */
async function mkDir(path){
    return new Promise((resolve, reject) => {
        fs.mkdir(path, (err) => {
            if (err) {
                reject(new Error(`Не могу создать папку ${path}`));
            }
            resolve();
        });
    });
}

/**
 * Копировать файлы шаблона во временную директорию
 * @param pathToTemplate
 * @returns {Promise<unknown>}
 */
async function cpTemplate(pathToTemplate){
    return new Promise((resolve, reject) => {
        child_process.exec(`cp -r odt_templates/myself/* ${pathToTemplate}`, (err) => {
            if (err) {
                reject(new Error(`Не могу скопировать файл шаблонов`));
            }
            resolve();
        });
    });
}

/**
 * вернуть содержимое файла
 * @param path
 * @param errMessage
 * @returns {Promise<unknown>}
 */
async function readFile(path, errMessage){
    return new Promise((resolve, reject) => {
        fs.readFile(path, (err, data) => {
            if(err){
                 reject(new Error(errMessage));
            }
            else {
                resolve(data);
            }
        });
    });
}

/**
 * Записать файл
 * @param path
 * @param data
 * @param errMessage
 * @returns {Promise<unknown>}
 */
async function writeFile(path, data, errMessage){
    return new Promise((resolve, reject) => {
        fs.writeFile(path, data, (err) => {
            if(err){
                reject(new Error(errMessage));
            }
            resolve();
        });
    });
}
