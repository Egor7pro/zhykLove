// ---- Supabase ----
const SUPA_URL = 'https://oxykfzxszgfjkyyzjudz.supabase.co';
const SUPA_KEY = 'sb_publishable_pMoqaaTItSB1tnrKCsBK-A_92rSvWd1';
const sb = supabase.createClient(SUPA_URL, SUPA_KEY);
let currentUser = null;

// Реальные анкеты из базы
let dbProfiles = [];

async function loadProfiles() {
  const { data, error } = await sb.from('profiles').select('*');
  if (error) {
    console.error('ОШИБКА загрузки анкет:', error.message);
    alert('Ошибка загрузки анкет: ' + error.message);
    return;
  }
  dbProfiles = (data || []).map(p => ({
    id: p.id,
    name: p.name || 'Без имени',
    age: p.age || 18,
    country: p.country || '',
    region: p.region || '',
    city: p.city || 'Не указан',
    bio: p.bio || '',
    gender: p.gender,
    photo: p.photo || null,
    km: null
  }));
  console.log('Загружено анкет из базы:', dbProfiles.length);
}

// Аватар: первая буква имени (если нет фото)
function avaInitial(name) {
  return (name || '?').trim().charAt(0).toUpperCase() || '?';
}

// Аватар чужой анкеты: фото, если есть, иначе буква
function personAvaHtml(u) {
  if (u.photo) {
    return `<img src="${u.photo}" alt="Аватар" style="width:100%;height:100%;object-fit:cover;">`;
  }
  return avaInitial(u.name);
}

// ---- Демо-анкеты ----
const USERS = [
  { id:1, name:'Алина', age:23, city:'Казань', bio:'Люблю кофе и спонтанные поездки 🚗', gender:'f', km:2 },
  { id:2, name:'Дина', age:25, city:'Казань', bio:'Танцую, читаю, готовлю лучший борщ 🍲', gender:'f', km:5 },
  { id:3, name:'Марат', age:27, city:'Казань', bio:'IT, гитара и настолки 🎸', gender:'m', km:3 },
  { id:4, name:'Соня', age:22, city:'Казань', bio:'Ищу компанию на концерт 🎤', gender:'f', km:8 },
  { id:5, name:'Артур', age:29, city:'Казань', bio:'Бегаю по утрам, мечтаю о марафоне 🏃', gender:'m', km:12 },
  { id:6, name:'Лейла', age:24, city:'Москва', bio:'Фотограф. Давай на красивый кадр 📸', gender:'f', km:720 },
];
const REPLIES = ['Привет! Как дела? 😊', 'Классный профиль!', 'Чем занят(а) на выходных?', 'Кофе или чай? ☕'];

// ---- Настройки монетизации ----
const FREE_CHARS = 20;
const CHARS_PER_COIN = 15;
const COIN_PRICE = 25;
const MIN_PACK = 10;
const VIP_MONTH_PRICE = 1800;
const VIP_YEAR_PRICE = 16800;
const PHOTO_MAX = 400;

// ---- Подарки (демо-оплата) ----
const GIFTS = [
  { id: 'heart', name: 'сердечко', emoji: '❤️', price: 125000 },
  { id: 'yacht', name: 'яхта',     emoji: '🛥️', price: 14700 },
  { id: 'bed',   name: 'кровать',  emoji: '🛏️', price: 4500 },
  { id: 'car',   name: 'машина',   emoji: '🚗', price: 2600 },
  { id: 'ring',  name: 'кольцо',   emoji: '💍', price: 400 },
  { id: 'rose',  name: 'роза',     emoji: '🌹', price: 25 },
];

// ---- Состояние ----
const STATE_VERSION = 11;

function stateKey() {
  return 'zhyklove_v' + STATE_VERSION + '_' + (currentUser ? currentUser.id : 'guest');
}

function defaultState() {
  return {
    me: null,
    seen: [],
    likes: [],
    matches: [],
    chats: {},
    filters: { city: '', min: 18, max: 99 },
    coins: 0,
    freeCharsLeft: FREE_CHARS,
    vip: false,
    vipType: null,
    vipUntil: null
  };
}

function defaultMe() {
  return {
    name: '', age: 18, gender: 'f', seeking: 'f',
    country: 'Россия', region: '', city: '',
    goal: 'flirt', marital: 'single', smoke: 'no', drink: 'no',
    bio: '', photo: null
  };
}

let state = defaultState();

function loadStateForUser() {
  try {
    const raw = localStorage.getItem(stateKey());
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s.me) return null;
    s.me = Object.assign(defaultMe(), s.me);
    // id везде храним строками — иначе демо-анкеты ломают поиск
    s.seen = (s.seen || []).map(String);
    s.likes = (s.likes || []).map(String);
    s.matches = (s.matches || []).map(String);
    if (!s.filters) s.filters = { city: '', min: 18, max: 99 };
    if (s.coins === undefined) s.coins = 0;
    if (s.freeCharsLeft === undefined) s.freeCharsLeft = FREE_CHARS;
    return s;
  } catch { return null; }
}

const save = () => localStorage.setItem(stateKey(), JSON.stringify(state));
let currentChat = null;

// ---- Поиск анкеты по id (строковое сравнение) ----
function findPerson(id) {
  return allPeople().find(x => String(x.id) === String(id));
}

// ---- Переключение регистрация/вход ----
function toggleAuth(showLogin) {
  document.getElementById('reg-fields').classList.toggle('hidden', showLogin);
  document.getElementById('login-fields').classList.toggle('hidden', !showLogin);
}

// ---- VIP ----
function vipActive() {
  if (!state.vip) return false;
  if (state.vipUntil && Date.now() > state.vipUntil) {
    state.vip = false;
    state.vipType = null;
    state.vipUntil = null;
    save();
    return false;
  }
  return true;
}

// ---- Стоимость сообщения ----
function messageCost(chars) {
  if (vipActive()) return { covered: chars, coins: 0 };
  const free = Math.min(chars, state.freeCharsLeft);
  const rest = chars - free;
  return { covered: free, coins: Math.ceil(rest / CHARS_PER_COIN) };
}

function limitsExhausted() {
  if (vipActive()) return false;
  return state.freeCharsLeft <= 0;
}

function updateCoinsUI() {
  const wall = document.getElementById('pay-wall');
  if (wall) wall.classList.toggle('hidden', !limitsExhausted());
  const header = document.getElementById('coins-count');
  if (header) header.textContent = state.coins;
  const shop = document.getElementById('shop-coins');
  if (shop) shop.textContent = state.coins;
}

// ---- Демо-оплата ----
function payRub(amount, description, onPaid) {
  const ok = confirm(
    `Оплата: ${description}\nСумма: ${amount.toLocaleString('ru-RU')} ₽\n\n` +
    `(демо-оплата — реальный платёжный шлюз не подключён)`
  );
  if (ok) onPaid();
}

// ---- Аватар: фото или первая буква имени ----
function renderAva(element) {
  if (state.me.photo) {
    element.innerHTML = `<img src="${state.me.photo}" alt="Аватар">`;
  } else {
    element.textContent = avaInitial(state.me.name);
  }
}

function updateAvas() {
  renderAva(document.getElementById('header-ava'));
  renderAva(document.getElementById('profile-ava'));
}

function handlePhoto(event) {
  const file = event.target.files && event.target.files[0];
  event.target.value = '';
  if (!file) return;
  if (!file.type.startsWith('image/')) return alert('Выберите файл изображения');
  if (file.size > 10 * 1024 * 1024) return alert('Файл слишком большой (до 10 МБ)');

  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, PHOTO_MAX / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      try {
        state.me.photo = canvas.toDataURL('image/jpeg', 0.8);
        save();
        updateAvas();
        document.getElementById('photo-remove').classList.remove('hidden');
      } catch {
        alert('Не удалось сохранить фото — возможно, не хватает места в хранилище');
      }
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}

function removePhoto() {
  state.me.photo = null;
  save();
  updateAvas();
  document.getElementById('photo-remove').classList.add('hidden');
}

// ---- Регистрация ----
async function register() {
  const email = document.getElementById('reg-email').value.trim();
  const pass = document.getElementById('reg-pass').value;
  const name = document.getElementById('reg-name').value.trim();
  const age = +document.getElementById('reg-age').value;
  const gender = document.getElementById('reg-gender').value;
  const seeking = document.getElementById('reg-seeking').value;

  if (!name || !age || age < 18 || !gender || !seeking) return alert('Заполните все поля (18+)');
  if (!email || !email.includes('@')) return alert('Укажите корректный email');
  if (pass.length < 6) return alert('Пароль — минимум 6 символов');

  const { data, error } = await sb.auth.signUp({ email, password: pass });
  if (error) return alert('Ошибка регистрации: ' + error.message);

  if (!data.session) {
    return alert('Письмо с подтверждением отправлено на ' + email +
      '. Подтвердите почту и войдите через кнопку «Войти».');
  }

  currentUser = data.user;

  state = defaultState();
  state.me = Object.assign(defaultMe(), { name, age, gender, seeking });
  state.freeCharsLeft = FREE_CHARS;
  save();

  saveProfileToDb();
  await loadProfiles();
  enterApp();
}

// ---- Вход ----
async function login() {
  const email = document.getElementById('login-email').value.trim();
  const pass = document.getElementById('login-pass').value;
  if (!email || !pass) return alert('Введите email и пароль');

  const { data, error } = await sb.auth.signInWithPassword({ email, password: pass });
  if (error) return alert('Не удалось войти: ' + error.message);

  currentUser = data.user;
  state = loadStateForUser();

  if (!state || !state.me) {
    const { data: p } = await sb.from('profiles').select('*').eq('id', currentUser.id).maybeSingle();
    state = defaultState();
    state.me = Object.assign(defaultMe(), p ? {
      name: p.name || email.split('@')[0],
      age: p.age || 18,
      gender: p.gender || 'f',
      seeking: p.seeking || 'f',
      country: p.country || 'Россия',
      region: p.region || '',
      city: p.city || '',
      goal: p.goal || 'flirt',
      marital: p.marital || 'single',
      smoke: p.smoke || 'no',
      drink: p.drink || 'no',
      bio: p.bio || '',
      photo: p.photo || null
    } : { name: email.split('@')[0] });
  }
  save();
  await loadProfiles();
  enterApp();
}

function enterApp() {
  document.getElementById('reg-screen').classList.add('hidden');
  document.getElementById('nav').classList.remove('hidden');
  document.getElementById('header').classList.remove('hidden');
  updateAvas();
  document.getElementById('photo-remove').classList.toggle('hidden', !state.me.photo);
  showScreen('home');
  updateCoinsUI();
}

// ---- Выход ----
function logout() {
  if (!confirm('Точно выйти? Лайки и чаты будут удалены.')) return;
  sb.auth.signOut();
  localStorage.removeItem(stateKey());
  currentUser = null;
  state = defaultState();
  dbProfiles = [];
  document.getElementById('reg-screen').classList.remove('hidden');
  document.getElementById('reg-fields').classList.remove('hidden');
  document.getElementById('login-fields').classList.add('hidden');
  document.getElementById('nav').classList.add('hidden');
  document.getElementById('header').classList.add('hidden');
  ['home','likes','chats','chat','profile'].forEach(x =>
    document.getElementById('screen-' + x).classList.add('hidden'));
}

// ---- Навигация ----
function showScreen(s) {
  ['home','likes','chats','chat','profile'].forEach(x =>
    document.getElementById('screen-' + x).classList.toggle('hidden', x !== s));
  ['home','likes','chats','profile'].forEach(x => {
    const b = document.getElementById('nav-' + x);
    if (b) b.classList.toggle('active', x === s);
  });
  if (s === 'home') loadProfiles().then(renderHome);
  if (s === 'likes') renderLikes();
  if (s === 'chats') renderChats();
  if (s === 'profile') renderProfile();
  if (s === 'chat') updateCoinsUI();
  updateBadges();
}

function updateBadges() {
  const lb = document.getElementById('likes-badge');
  if (state.likes.length) { lb.textContent = state.likes.length; lb.classList.remove('hidden'); }
  else lb.classList.add('hidden');
  const cb = document.getElementById('chats-badge');
  const unread = Object.values(state.chats).reduce((n, msgs) => n + (msgs.length && !msgs[msgs.length-1].me ? 1 : 0), 0);
  if (unread) { cb.textContent = unread; cb.classList.remove('hidden'); }
  else cb.classList.add('hidden');
}

// ---- Лента анкет ----
function allPeople() {
  const myId = currentUser && currentUser.id;
  const real = dbProfiles.filter(p => p.id !== myId);
  return [...real, ...USERS];
}

function candidates() {
  const f = state.filters;
  return allPeople()
    .filter(u => u.id && !state.seen.includes(String(u.id)))
    .filter(u => !state.me.seeking || u.gender === state.me.seeking)
    .filter(u => !f.city || (u.city || '').toLowerCase().includes(f.city.toLowerCase()))
    .filter(u => u.age >= f.min && u.age <= f.max);
}

// ---- Главная ----
function renderHome() {
  const box = document.getElementById('screen-home');
  const list = candidates();
  if (!list.length) {
    box.innerHTML = `
      <div class="empty">Анкеты закончились 🎉</div>
      <button class="btn-main" style="margin-top:16px" onclick="restartFeed()">🔄 Смотреть заново</button>`;
    return;
  }
  const u = list[0];
  box.innerHTML = `
    <div class="card">
      <div class="photo">${personAvaHtml(u)}</div>
      ${u.km ? `<div class="distance">📍 ${u.km} км от тебя</div>` : ''}
      <div class="info"><h2>${u.name}, ${u.age}</h2><p>${u.city} · ${u.bio}</p></div>
    </div>
    <div class="actions">
      <button class="btn-no" onclick="swipe(false)">✕</button>
      <button class="btn-yes" onclick="swipe(true)">❤</button>
    </div>`;
}

function swipe(like) {
  const u = candidates()[0];
  if (!u) return;
  state.seen.push(String(u.id));
  if (like) {
    const uid = String(u.id);
    state.likes.push(uid);
    if (!state.matches.includes(uid)) state.matches.push(uid);
    if (!state.chats[uid]) state.chats[uid] = [];
    openMatch(uid);
  }
  save();
  renderHome();
}

function restartFeed() {
  state.seen = [];
  save();
  renderHome();
}

// ---- Попап совпадения ----
let matchUserId = null;
function openMatch(id) {
  matchUserId = id;
  const u = findPerson(id);
  document.getElementById('match-text').textContent = 'Вы с ' + u.name + ' совпали! Напишите первым 😉';
  document.getElementById('match-modal').classList.remove('hidden');
}
function closeMatch(gotoChat) {
  document.getElementById('match-modal').classList.add('hidden');
  if (gotoChat && matchUserId !== null) openChat(matchUserId);
  matchUserId = null;
}

// ---- Лайкнутые ----
function renderLikes() {
  const box = document.getElementById('likes-list');
  const list = state.likes.map(id => findPerson(id)).filter(Boolean);
  if (!list.length) {
    box.innerHTML = '<div class="empty">Пока никто не лайкнут.<br>Ставь ❤ на главной!</div>';
    return;
  }
  box.innerHTML = list.map(u => {
    const isMatch = state.matches.includes(String(u.id));
    return `
    <div class="person-row" onclick="${isMatch ? `openChat('${u.id}')` : ''}">
      <div class="ava">${personAvaHtml(u)}</div>
      <div><div class="name">${u.name}, ${u.age}</div>
      <div class="sub">${u.city}</div></div>
      <div class="tag ${isMatch ? 'match' : 'wait'}">${isMatch ? 'Взаимно 💜' : 'Ждёт ответа'}</div>
    </div>`;
  }).join('');
}

// ---- Фильтр ----
function renderFilter() {
  document.getElementById('flt-seeking').value = state.me.seeking;
  document.getElementById('flt-city').value = state.filters.city || '';
  document.getElementById('flt-min').value = state.filters.min || '';
  document.getElementById('flt-max').value = state.filters.max || '';
  updateFilterNote();
}
function applyFilter() {
  const seeking = document.getElementById('flt-seeking').value;
  const city = document.getElementById('flt-city').value.trim();
  let min = +document.getElementById('flt-min').value || 18;
  let max = +document.getElementById('flt-max').value || 99;
  if (min > max) [min, max] = [max, min];
  state.me.seeking = seeking;
  state.filters = { city, min, max };
  save();
  saveProfileToDb();
  updateFilterNote();
  showScreen('home');
}
function updateFilterNote() {
  const f = state.filters;
  const n = allPeople()
    .filter(u => u.gender === state.me.seeking)
    .filter(u => !f.city || (u.city || '').toLowerCase().includes(f.city.toLowerCase()))
    .filter(u => u.age >= f.min && u.age <= f.max).length;
  document.getElementById('flt-note').textContent = `Под фильтр попадает анкет: ${n}`;
}

// ---- Профиль ----
function renderProfile() {
  const me = state.me;
  renderAva(document.getElementById('profile-ava'));
  document.getElementById('prof-name').value = me.name;
  document.getElementById('prof-age').value = me.age;
  document.getElementById('prof-country').value = me.country || 'Россия';
  document.getElementById('prof-region').value = me.region || '';
  document.getElementById('prof-city').value = me.city || '';
  document.getElementById('prof-gender').value = me.gender;
  document.getElementById('prof-seeking').value = me.seeking;
  document.getElementById('prof-goal').value = me.goal || 'flirt';
  document.getElementById('prof-marital').value = me.marital || 'single';
  document.getElementById('prof-smoke').value = me.smoke || 'no';
  document.getElementById('prof-drink').value = me.drink || 'no';
  document.getElementById('prof-bio').value = me.bio || '';
  document.getElementById('prof-note').textContent = '';
  updateBioCount();
  document.getElementById('photo-remove').classList.toggle('hidden', !me.photo);
  document.getElementById('stat-likes').textContent = state.likes.length;
  document.getElementById('stat-matches').textContent = state.matches.length;
  document.getElementById('stat-chats').textContent =
    Object.values(state.chats).filter(m => m.length).length;
  updateCoinsUI();
}

function updateBioCount() {
  const bio = document.getElementById('prof-bio');
  const note = document.getElementById('bio-count');
  note.textContent = `${bio.value.length} / 120`;
  note.classList.toggle('warn', bio.value.length > 100);
}

async function saveProfileToDb() {
  if (!currentUser) return;
  const me = state.me;
  const { error } = await sb.from('profiles').upsert({
    id: currentUser.id,
    name: me.name,
    age: me.age,
    gender: me.gender,
    seeking: me.seeking,
    country: me.country,
    region: me.region,
    city: me.city,
    goal: me.goal,
    marital: me.marital,
    smoke: me.smoke,
    drink: me.drink,
    bio: me.bio,
    emoji: avaInitial(me.name),
    photo: me.photo
  });
  if (error) {
    console.error('ОШИБКА сохранения профиля:', error.message);
    alert('Не сохранилось: ' + error.message);
  }
}

async function saveProfile() {
  const name = document.getElementById('prof-name').value.trim();
  const age = +document.getElementById('prof-age').value;
  const bio = document.getElementById('prof-bio').value;
  if (!name || !age || age < 18) {
    document.getElementById('prof-note').textContent = 'Имя и возраст (18+) обязательны';
    return;
  }
  if (bio.length > 120) {
    document.getElementById('prof-note').textContent = 'О себе — не больше 120 символов';
    return;
  }
  const me = state.me;
  me.name = name;
  me.age = age;
  me.country = document.getElementById('prof-country').value;
  me.region = document.getElementById('prof-region').value.trim();
  me.city = document.getElementById('prof-city').value.trim();
  me.gender = document.getElementById('prof-gender').value;
  me.seeking = document.getElementById('prof-seeking').value;
  me.goal = document.getElementById('prof-goal').value;
  me.marital = document.getElementById('prof-marital').value;
  me.smoke = document.getElementById('prof-smoke').value;
  me.drink = document.getElementById('prof-drink').value;
  me.bio = bio.trim();
  save();

  await saveProfileToDb();
  await loadProfiles();
  updateAvas();
  document.getElementById('prof-note').textContent = 'Профиль сохранён ✅';
}

document.getElementById('prof-bio').addEventListener('input', updateBioCount);
document.getElementById('photo-input').addEventListener('change', handlePhoto);

// ---- Магазин монет ----
function buyCoins(n) {
  n = Math.floor(+n);
  if (!n || n < MIN_PACK) return alert(`Минимум для покупки — ${MIN_PACK} монет`);
  const cost = n * COIN_PRICE;
  payRub(cost, `${n} монет`, () => {
    state.coins += n;
    save();
    updateCoinsUI();
    alert(`Начислено ${n} монет 💎`);
  });
}

function buyCustom() {
  const n = +document.getElementById('buy-custom').value;
  buyCoins(n);
  document.getElementById('buy-custom').value = '';
}

function buyVip() {
  if (vipActive()) {
    const until = new Date(state.vipUntil).toLocaleDateString('ru-RU');
    alert(`У вас уже активен VIP до ${until}`);
    return;
  }
  const choice = prompt(
    `VIP-подписка — безлимитные сообщения:\n` +
    `1 — месяц за ${VIP_MONTH_PRICE} ₽\n` +
    `2 — год за ${VIP_YEAR_PRICE} ₽\n\nВведите 1 или 2:`
  );
  if (choice === '1') {
    payRub(VIP_MONTH_PRICE, 'VIP на месяц (безлимит)', () => {
      state.vip = true;
      state.vipType = 'month';
      state.vipUntil = Date.now() + 30 * 24 * 60 * 60 * 1000;
      save();
      updateCoinsUI();
      alert('VIP активирован! ✨ Безлимитные сообщения включены.');
    });
  } else if (choice === '2') {
    payRub(VIP_YEAR_PRICE, 'VIP на год (безлимит)', () => {
      state.vip = true;
      state.vipType = 'year';
      state.vipUntil = Date.now() + 365 * 24 * 60 * 60 * 1000;
      save();
      updateCoinsUI();
      alert('VIP активирован! ✨ Безлимитные сообщения включены.');
    });
  }
}

// ---- Подарки ----
let gift = { id: null, qty: 1 };

function openGifts() {
  if (currentChat === null) return alert('Открой чат с человеком, которому хочешь подарить');
  const u = findPerson(currentChat);
  if (!u) return alert('Не удалось найти получателя подарка');
  gift = { id: null, qty: 1 };
  document.getElementById('gift-to').textContent = `Кому: ${u.name}`;
  document.getElementById('gift-qty').textContent = '1';
  document.getElementById('gift-total').textContent = 'Выберите подарок';
  renderGiftList();
  document.getElementById('gift-modal').classList.remove('hidden');
}

function renderGiftList() {
  const box = document.getElementById('gift-list');
  if (!box) return;
  box.innerHTML = GIFTS.map(g => `
    <div class="gift-item ${gift.id === g.id ? 'sel' : ''}" data-id="${g.id}" onclick="pickGift('${g.id}')">
      <span class="gift-emoji">${g.emoji}</span>
      <span>${g.name}</span>
      <span class="gift-price">${g.price.toLocaleString('ru-RU')} ₽</span>
    </div>`).join('');
}

function closeGift() {
  document.getElementById('gift-modal').classList.add('hidden');
}

function pickGift(id) {
  gift.id = id;
  gift.qty = 1;
  document.getElementById('gift-qty').textContent = '1';
  renderGiftList();
  updateGiftTotal();
}

function changeQty(delta) {
  if (!gift.id) return;
  gift.qty = Math.max(1, gift.qty + delta);
  document.getElementById('gift-qty').textContent = gift.qty;
  updateGiftTotal();
}

function updateGiftTotal() {
  const g = GIFTS.find(x => x.id === gift.id);
  if (!g) return;
  document.getElementById('gift-total').textContent =
    `Итого: ${(g.price * gift.qty).toLocaleString('ru-RU')} ₽ (${gift.qty} шт.)`;
}

function sendGift() {
  if (!gift.id) return alert('Сначала выберите подарок в списке');
  const g = GIFTS.find(x => x.id === gift.id);
  const total = g.price * gift.qty;
  const u = findPerson(currentChat);
  if (!u) return alert('Не удалось найти получателя подарка');

  payRub(total, `${g.emoji} ${g.name} × ${gift.qty} для ${u.name}`, () => {
    state.chats[String(currentChat)].push({
      me: true,
      text: `${g.emoji} Подарил(а) ${u.name}: ${g.name} × ${gift.qty} (оплачено ${total.toLocaleString('ru-RU')} ₽)`
    });
    save();
    closeGift();
    renderChat();
    updateBadges();

    setTimeout(() => {
      const thanks = [
        `${g.emoji} Спасибо! Это лучший подарок! 💜`,
        `${g.emoji} Ого, как щедро! Спасибо 💜`,
        `${g.emoji} Вы меня балуете! Спасибо 😊`
      ];
      state.chats[String(currentChat)].push({ me: false, text: thanks[Math.floor(Math.random() * thanks.length)] });
      save();
      if (currentChat !== null) renderChat();
      updateBadges();
    }, 1200);
  });
}

// ---- Чаты ----
function renderChats() {
  const box = document.getElementById('chats-list');
  const list = state.matches.map(id => findPerson(id)).filter(Boolean);
  if (!list.length) {
    box.innerHTML = '<div class="empty">Пока пусто. Ставьте ❤ на главной!</div>';
    return;
  }
  box.innerHTML = list.map(u => {
    const msgs = state.chats[String(u.id)] || [];
    const last = msgs.length ? msgs[msgs.length-1].text : 'Напишите первым ✍️';
    return `
    <div class="person-row" onclick="openChat('${u.id}')">
      <div class="ava">${personAvaHtml(u)}</div>
      <div><div class="name">${u.name}, ${u.age}</div>
      <div class="sub">${last.length > 28 ? last.slice(0, 28) + '…' : last}</div></div>
    </div>`;
  }).join('');
}

function openChat(id) {
  currentChat = String(id);
  showScreen('chat');
  const u = findPerson(currentChat);
  if (!u) return;
  const chatAva = document.getElementById('chat-ava');
  if (u.photo) {
    chatAva.innerHTML = `<img src="${u.photo}" alt="Аватар">`;
  } else {
    chatAva.textContent = avaInitial(u.name);
  }
  document.getElementById('chat-name').textContent = u.name;
  document.getElementById('chat-age').textContent = u.city;
  if (!state.chats[currentChat]) state.chats[currentChat] = [];
  renderChat();
  updateCoinsUI();
}

function renderChat() {
  const box = document.getElementById('chat-box');
  box.innerHTML = (state.chats[currentChat] || []).map(m =>
    `<div class="msg ${m.me ? 'me' : 'them'}">${m.text}</div>`).join('');
  box.scrollTop = box.scrollHeight;
}

function sendMessage() {
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (!text || currentChat === null) return;

  const chars = text.length;
  const cost = messageCost(chars);

  if (cost.coins > state.coins) {
    const need = cost.coins - state.coins;
    if (!confirm(
      `Не хватает ${need} 💎 на это сообщение.\n` +
      `Перейти в магазин в профиле?`
    )) return;
    showScreen('profile');
    return;
  }

  if (cost.coins > 0) state.coins -= cost.coins;

  if (!vipActive()) {
    state.freeCharsLeft -= cost.covered;
    if (state.freeCharsLeft < 0) state.freeCharsLeft = 0;
  }

  state.chats[currentChat].push({ me: true, text });
  save();
  input.value = '';
  renderChat();
  updateBadges();
  updateCoinsUI();

  setTimeout(() => {
    state.chats[currentChat].push({ me: false, text: REPLIES[Math.floor(Math.random() * REPLIES.length)] });
    save();
    if (currentChat !== null) renderChat();
    updateBadges();
  }, 1200);
}

document.getElementById('chat-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') sendMessage();
});

// ---- Старт ----
(async () => {
  const { data } = await sb.auth.getSession();
  const session = data && data.session;
  if (session) {
    currentUser = session.user;
    await loadProfiles();
    state = loadStateForUser();
    if (!state || !state.me) {
      const { data: p } = await sb.from('profiles').select('*').eq('id', currentUser.id).maybeSingle();
      state = defaultState();
      state.me = Object.assign(defaultMe(), p ? {
        name: p.name || 'Без имени',
        age: p.age || 18,
        gender: p.gender || 'f',
        seeking: p.seeking || 'f',
        country: p.country || 'Россия',
        region: p.region || '',
        city: p.city || '',
        goal: p.goal || 'flirt',
        marital: p.marital || 'single',
        smoke: p.smoke || 'no',
        drink: p.drink || 'no',
        bio: p.bio || '',
        photo: p.photo || null
      } : { name: 'Без имени' });
    }
    if (state.me) enterApp();
  }
})();
