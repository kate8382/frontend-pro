/* eslint-disable no-console */
// импорт стандартных библиотек Node.js
const { existsSync, readFileSync, writeFileSync, statSync } = require('fs'); // импортируем функции для работы с файловой системой
const { createServer } = require('http');
const path = require('path'); // Добавьте этот импорт

// файл для базы данных
const DB_FILE = process.env.DB_FILE || './db.json';
// номер порта, на котором будет запущен сервер
const PORT = process.env.PORT || 3000;
// префикс URI для всех методов приложения
const URI_PREFIX = '/api/clients';

/**
 * Класс ошибки, используется для отправки ответа с определённым кодом и описанием ошибки
 */
class ApiError extends Error {
  constructor(statusCode, data) {
    super();
    this.statusCode = statusCode;
    this.data = data;
  }
}

/**
 * Асинхронно считывает тело запроса и разбирает его как JSON
 * @param {Object} req - Объект HTTP запроса
 * @throws {ApiError} Некорректные данные в аргументе
 * @returns {Object} Объект, созданный из тела запроса
 */
function drainJson(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
    });
    req.on('end', () => {
      resolve(JSON.parse(data));
    });
  });
}

/**
 * Проверяет входные данные и создаёт из них корректный объект клиента
 * @param {Object} data - Объект с входными данными
 * @throws {ApiError} Некорректные данные в аргументе (statusCode 422)
 * @returns {{ name: string, surname: string, lastName: string, contacts: object[] }} Объект клиента
 */
function makeClientFromData(data) {
  const errors = [];

  function asString(v) {
    return v && String(v).trim() || '';
  }

  // составляем объект, где есть только необходимые поля
  const client = {
    name: asString(data.name),
    surname: asString(data.surname),
    lastName: asString(data.lastName),
    contacts: Array.isArray(data.contacts) ? data.contacts.map(contact => ({
      type: asString(contact.type),
      value: asString(contact.value),
    })) : [],
  };

  // проверяем, все ли данные корректные и заполняем объект ошибок, которые нужно отдать клиенту
  if (!client.name) errors.push({ field: 'name', message: 'Не указано имя' });
  if (!client.surname) errors.push({ field: 'surname', message: 'Не указана фамилия' });
  if (client.contacts.some(contact => !contact.type || !contact.value))
    errors.push({ field: 'contacts', message: 'Не все добавленные контакты полностью заполнены' });

  // если есть ошибки, то бросаем объект ошибки с их списком и 422 статусом
  if (errors.length) throw new ApiError(422, { errors });

  return client;
}

/**
 * Возвращает список клиентов из базы данных
 * @param {{ search: string }} [params] - Поисковая строка
 * @returns {{ id: string, name: string, surname: string, lastName: string, contacts: object[] }[]} Массив клиентов
 */
function getClientList(params = {}) {
  const clients = JSON.parse(readFileSync(DB_FILE) || '[]');
  if (params.search) {
    const search = params.search.trim().toLowerCase();
    return clients.filter(client => [
      client.name,
      client.surname,
      client.lastName,
      ...client.contacts.map(({ value }) => value)
    ]
      .some(str => str.toLowerCase().includes(search))
    );
  }
  return clients;
}

/**
 * Возвращает список автозаполнения клиентов по запросу
 * @param {string} query - Поисковая строка
 * @returns {{ id: string, name: string, surname: string, lastName: string }[]} Массив клиентов для автозаполнения
 */
// функция для автозаполнения
function getAutocompleteItems(query) {
  const clients = getClientList(); // получаем список клиентов
  // если не передан запрос, то возвращаем пустой массив
  const search = query.trim().toLowerCase();
  return clients
    .filter(client => // проверяем, что хотя бы одно из полей клиента содержит искомую строку
      [client.name, client.surname, client.lastName]
        .some(str => str.toLowerCase().includes(search)) // проверяем, что строка из поля клиента содержит искомую строку
    )
    .map(client => ({ // возвращаем массив объектов с id, name, surname и lastName
      id: client.id,
      name: client.name,
      surname: client.surname,
      lastName: client.lastName,
    }));
}

/**
 * Создаёт и сохраняет клиента в базу данных
 * @throws {ApiError} Некорректные данные в аргументе, клиент не создан (statusCode 422)
 * @param {Object} data - Данные из тела запроса
 * @returns {{ id: string, name: string, surname: string, lastName: string, contacts: object[], createdAt: string, updatedAt: string }} Объект клиента
 */
function createClient(data) {
  const newItem = makeClientFromData(data);
  newItem.id = Date.now().toString();
  newItem.createdAt = newItem.updatedAt = new Date().toISOString();
  writeFileSync(DB_FILE, JSON.stringify([...getClientList(), newItem]), { encoding: 'utf8' });
  return newItem;
}

/**
 * Возвращает объект клиента по его ID
 * @param {string} itemId - ID клиента
 * @throws {ApiError} Клиент с таким ID не найден (statusCode 404)
 * @returns {{ id: string, name: string, surname: string, lastName: string, contacts: object[], createdAt: string, updatedAt: string }} Объект клиента
 */
function getClient(itemId) {
  const client = getClientList().find(({ id }) => id === itemId);
  if (!client) throw new ApiError(404, { message: 'Client Not Found' });
  return client;
}

/**
 * Изменяет клиента с указанным ID и сохраняет изменения в базу данных
 * @param {string} itemId - ID изменяемого клиента
 * @param {{ name?: string, surname?: string, lastName?: string, contacts?: object[] }} data - Объект с изменяемыми данными
 * @throws {ApiError} Клиент с таким ID не найден (statusCode 404)
 * @throws {ApiError} Некорректные данные в аргументе (statusCode 422)
 * @returns {{ id: string, name: string, surname: string, lastName: string, contacts: object[], createdAt: string, updatedAt: string }} Объект клиента
 */
function updateClient(itemId, data) {
  const clients = getClientList();
  const itemIndex = clients.findIndex(({ id }) => id === itemId);
  if (itemIndex === -1) throw new ApiError(404, { message: 'Client Not Found' });
  Object.assign(clients[itemIndex], makeClientFromData({ ...clients[itemIndex], ...data }));
  clients[itemIndex].updatedAt = new Date().toISOString();
  writeFileSync(DB_FILE, JSON.stringify(clients), { encoding: 'utf8' });
  return clients[itemIndex];
}

/**
 * Удаляет клиента из базы данных
 * @param {string} itemId - ID клиента
 * @returns {{}}
 */
function deleteClient(itemId) {
  const clients = getClientList();
  const itemIndex = clients.findIndex(({ id }) => id === itemId);
  if (itemIndex === -1) throw new ApiError(404, { message: 'Client Not Found' });
  clients.splice(itemIndex, 1);
  writeFileSync(DB_FILE, JSON.stringify(clients), { encoding: 'utf8' });
  return {};
}

// создаём новый файл с базой данных, если он не существует
if (!existsSync(DB_FILE)) writeFileSync(DB_FILE, '[]', { encoding: 'utf8' });

// создаём HTTP сервер, переданная функция будет реагировать на все запросы к нему
module.exports = createServer(async (req, res) => {
  // req - объект с информацией о запросе, res - объект для управления отправляемым ответом

  // этот заголовок ответа указывает, что тело ответа будет в JSON формате
  res.setHeader('Content-Type', 'application/json');

  // CORS заголовки ответа для поддержки кросс-доменных запросов из браузера
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // запрос с методом OPTIONS может отправлять браузер автоматически для проверки CORS заголовков
  // в этом случае достаточно ответить с пустым телом и этими заголовками
  if (req.method === 'OPTIONS') {
    // end = закончить формировать ответ и отправить его клиенту
    res.end();
    return;
  }

  // обработка статических файлов
  const staticFilePath = path.join(__dirname, '../frontend', req.url); // путь к статическому файлу
  // проверяем, что файл существует и не является директорией
  if (existsSync(staticFilePath) && req.method === 'GET' && !statSync(staticFilePath).isDirectory()) { // проверяем, что файл существует и не является директорией
    // если файл существует, то читаем его и отправляем в ответе
    const ext = path.extname(staticFilePath).toLowerCase(); // получаем расширение файла
    // устанавливаем соответствующий заголовок Content-Type (например, для .html - text/html, для .css - text/css и т.д.)
    const contentType = {
      '.html': 'text/html',
      '.css': 'text/css',
      '.js': 'application/javascript',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.svg': 'image/svg+xml',
      '.json': 'application/json',
    }[ext] || 'application/octet-stream'; // универсальный тип, который подходит для всех типов файлов

    res.setHeader('Content-Type', contentType); // устанавливаем заголовок Content-Type в зависимости от расширения файла
    res.end(readFileSync(staticFilePath)); // читаем файл и отправляем его в ответе
    return;
  }

  // если URI не начинается с нужного префикса - можем сразу отдать 404
  if (!req.url || !req.url.startsWith(URI_PREFIX)) { // проверяем, что URI начинается с нужного префикса
    if (req.url === '/') { // если URI равен /, то возвращаем HTML файл по умолчанию
      // Возвращаем HTML файл по умолчанию
      const htmlFilePath = path.join(__dirname, '../frontend/index.html'); // путь к HTML файлу
      const htmlContent = readFileSync(htmlFilePath, 'utf8'); // читаем HTML файл
      res.setHeader('Content-Type', 'text/html'); // устанавливаем заголовок Content-Type в text/html
      res.end(htmlContent); // отправляем HTML файл в ответе
      return;
    } else {
      res.statusCode = 404;
      res.end(JSON.stringify({ message: 'Not Found' }));
      return;
    }
  }

  // убираем из запроса префикс URI, разбиваем его на путь и параметры
  const [uri, query] = req.url.substr(URI_PREFIX.length).split('?');
  const queryParams = {};

  // параметры могут отсутствовать вообще или иметь вид a=b&b=c
  // во втором случае наполняем объект queryParams { a: 'b', b: 'c' }
  if (query) {
    for (const piece of query.split('&')) {
      const [key, value] = piece.split('=');
      queryParams[key] = value ? decodeURIComponent(value) : '';
    }
  }

  try {
    // обрабатываем запрос и формируем тело ответа
    const body = await (async () => {
      if (uri === '' || uri === '/') {
        // /api/clients
        if (req.method === 'GET') return getClientList(queryParams);
        if (req.method === 'POST') {
          const createdItem = createClient(await drainJson(req));
          res.statusCode = 201;
          res.setHeader('Access-Control-Expose-Headers', 'Location');
          res.setHeader('Location', `${URI_PREFIX}/${createdItem.id}`);
          return createdItem;
        }
      } else if (uri === '/autocomplete') { // если URI равен /api/clients/autocomplete
        if (req.method === 'GET') { // если метод GET
          // получаем список автозаполнения клиентов по запросу
          // queryParams - объект с параметрами запроса
          const { query } = queryParams;
          return getAutocompleteItems(query);
        }
      } else if (uri.startsWith('/#')) { // если URI начинается с /#
        // /#id клиента
        const itemId = uri.substr(2); // Удаляем символ # из URI
        if (req.method === 'GET') { // если метод GET
          // Получаем клиента по его ID
          const client = getClient(itemId);
          const htmlFilePath = path.join(__dirname, '../frontend/index.html'); // путь к HTML файлу
          let htmlContent = readFileSync(htmlFilePath, 'utf8'); // читаем HTML файл
          // Добавляем скрипт для открытия модального окна с данными клиента
          const script = `<script>
            document.addEventListener('DOMContentLoaded', () => {
              const client = ${JSON.stringify(client)};
              openEditModal(client, elements, clientsList, renderClientsTable, filterInp, getClientItem, sortClientsTable, switchSort);
            });
          </script>`;
          htmlContent = htmlContent.replace('</body>', `${script}</body>`); // добавляем скрипт в конец HTML файла
          res.setHeader('Content-Type', 'text/html'); // устанавливаем заголовок Content-Type в text/html
          res.end(htmlContent); // отправляем HTML файл в ответе
          return;
        }
      } else {
        // /api/clients/{id}
        // параметр {id} из URI запроса
        const itemId = uri.substr(1);
        if (req.method === 'GET') return getClient(itemId);
        if (req.method === 'PATCH') return updateClient(itemId, await drainJson(req)); // обновляем клиента
        if (req.method === 'DELETE') return deleteClient(itemId);
      }
      return null;
    })();
    if (body) { // если тело ответа не пустое, то отправляем его
      res.end(JSON.stringify(body));
    }
  } catch (err) {
    // обрабатываем сгенерированную нами же ошибку
    if (err instanceof ApiError) {
      res.writeHead(err.statusCode);
      res.end(JSON.stringify(err.data));
    } else {
      // если что-то пошло не так - пишем об этом в консоль и возвращаем 500 ошибку сервера
      res.statusCode = 500;
      res.end(JSON.stringify({ message: 'Server Error' }));
      console.error(err);
    }
  }
})
  // выводим инструкцию, как только сервер запустился...
  .on('listening', () => {
    if (process.env.NODE_ENV !== 'test') {
      console.log(`Сервер CRM запущен. Вы можете использовать его по адресу http://localhost:${PORT}`);
      console.log('Нажмите CTRL+C, чтобы остановить сервер');
      console.log('Доступные методы:');
      console.log(`GET ${URI_PREFIX} - получить список клиентов, в query параметр search можно передать поисковый запрос`);
      console.log(`POST ${URI_PREFIX} - создать клиента, в теле запроса нужно передать объект { name: string, surname: string, lastName?: string, contacts?: object[] }`);
      console.log(`\tcontacts - массив объектов контактов вида { type: string, value: string }`);
      console.log(`GET ${URI_PREFIX}/{id} - получить клиента по его ID`);
      console.log(`PATCH ${URI_PREFIX}/{id} - изменить клиента с ID, в теле запроса нужно передать объект { name?: string, surname?: string, lastName?: string, contacts?: object[] }`);
      console.log(`\tcontacts - массив объектов контактов вида { type: string, value: string }`);
      console.log(`DELETE ${URI_PREFIX}/{id} - удалить клиента по ID`);
      console.log(`GET ${URI_PREFIX}/autocomplete?query={query} - получить список автозаполнения клиентов по запросу`);
      console.log(`GET /#id клиента - получить клиента по его ID из hash-части URL`);
    }
  })
  // ...и вызываем запуск сервера на указанном порту
  .listen(PORT);
