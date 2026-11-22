// ---- Supabase (добавлено) ----
const SUPA_URL = 'https://oxykfzxszgfjkyyzjudz.supabase.co';
const SUPA_KEY = 'sb_publishable_pMoqaaTItSB1tnrKCsBK-A_92rSvWd1';
const sb = supabase.createClient(SUPA_URL, SUPA_KEY);
let currentUser = null;

// ---- Демо-анкеты ----
const USERS = [
  { id:1, name:'Алина', age:23, city:'Казань', bio:'Люблю кофе и спонтанные поездки 🚗', emoji:'👩‍🦰', gender:'f', km:2 },
  { id:2, name:'Дина', age:25, city:'Казань', bio:'Танцую, читаю, готовлю лучший борщ 🍲', emoji:'💃', gender:'f', km:5 },
  { id:3, name:'Марат', age:27, city:'Казань', bio:'IT, гитара и настолки 🎸', emoji:'🧑‍💻', gender:'m', km:3 },
  { id:4, name:'Соня', age:22, city:'Казань', bio:'Ищу компанию на концерт 🎤', emoji:'🙋‍♀️', gender:'f', km:8 },
  { id:5, name:'Артур', age:29, city:'Казань', bio:'Бегаю по утрам, мечтаю о марафоне 🏃', emoji:'🏋️', gender:'m', km:12 },
  { id:6, name:'Лейла', age:24, city:'Москва', bio:'Фотограф. Давай на красивый кадр 📸', emoji:'📷', gender:'f', km:720 },
];
const REPLIES = ['Привет! Как дела? 😊', 'Классный профиль!', 'Чем занимаешься на выходных?', 'Кофе или чай? ☕'];
const AVATARS = ['🙂','😎','🦊','🐱','🐼','🦄','🎃','🌟','🚀','🎧','🌸','🔥'];

// ---- Настройки монетизации ----
const FREE_CHARS = 20;
const CHARS_PER_COIN = 15;
const COIN_PRICE = 25;
const MIN_PACK = 10;
const VIP_MONTH_PRICE = 1800;
const VIP_YEAR_PRICE = 16800;
const PHOTO_MAX = 400;

// ---- Подарки ----
const GIFTS = [
  { id: 'car',  name: 'машина', emoji: '🚗', price: 2500 },
  { id: 'ring', name: 'кольцо', emoji: '💍', price: 200 },
  { id: 'rose', name: 'роза',   emoji: '🌹', price: 20 },
];

// ---- Состояние (изменено: ключ теперь привязан к аккаунту) ----
const STATE_VERSION = 9;

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

let state = defaultState();

function loadStateForUser() {
  try {
    const raw = localStorage.getItem(stateKey());
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s.me) return null;
    if (!s.filters) s.filters = { city: '', min: 18, max: 99 };
    if (s.coins === undefined) s.coins = 0;
    if (s.freeCharsLeft === undefined) s.freeCharsLeft = FREE_CHARS;
    return s;
  } catch { return null; }
}

const save = () => localStorage.setItem(stateKey(), JSON.stringify(state));
let currentChat = null;

// ---- Переключение регистрация/вход (добавлено) ----
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
    `Оплата: ${description}\nСумма: ${amount} ₽\n\n` +
    `(демо-оплата — реальный платёжный шлюз не подключён)`
  );
  if (ok) onPaid();
}

// ---- Аватар ----
function renderAva(element) {
  if (state.me.photo) {
    element.innerHTML = `<img src="${state.me.photo}" alt="Аватар">`;
  } else {
    element.textContent = state.me.emoji;
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

// ---- Регистрация (изменено: теперь через Supabase) ----
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

  // Если сессии нет — включено подтверждение почты
  if (!data.session) {
    return alert('Письмо с подтверждением отправлено на ' + email +
      '. Подтвердите почту и войдите через кнопку «Войти».');
  }

  currentUser = data.user;

  // Сохраняем анкету в базу
  const { error: dbErr } = await sb.from('profiles').upsert({
    id: currentUser.id,
    name, age, gender, seeking,
    city: '', bio: '', emoji: '🙂'
  });
  if (dbErr) console.warn('Профиль не сохранён в базу:', dbErr.message);

  state = defaultState();
  state.me = { name, age, gender, seeking, city: '', bio: '', emoji: '🙂', photo: null };
  state.freeCharsLeft = FREE_CHARS;
  save();
  enterApp();
}

// ---- Вход (добавлено) ----
async function login() {
  const email = document.getElementById('login-email').value.trim();
  const pass = document.getElementById('login-pass').value;
  if (!email || !pass) return alert('Введите email и пароль');

  const { data, error } = await sb.auth.signInWithPassword({ email, password: pass });
  if (error) return alert('Не удалось войти: ' + error.message);

  currentUser = data.user;
  state = loadStateForUser();

  if (!state || !state.me) {
    // Анкеты в localStorage нет — подтягиваем из базы
    const { data: p } = await sb.from('profiles').select('*').eq('id', currentUser.id).maybeSingle();
    state = defaultState();
    state.me = {
      name: (p && p.name) || email.split('@')[0],
      age: (p && p.age) || 18,
      gender: (p && p.gender) || 'f',
      seeking: (p && p.seeking) || 'f',
      city: (p && p.city) || '',
      bio: (p && p.bio) || '',
      emoji: (p && p.emoji) || '🙂',
      photo: null
    };
  }
  save();
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

// ---- Выход (изменено: теперь и из Supabase) ----
function logout() {
  if (!confirm('Точно выйти? Лайки и чаты будут удалены.')) return;
  sb.auth.signOut();
  localStorage.removeItem(stateKey());
  currentUser = null;
  state = defaultState();
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
  if (s === 'home') renderHome();
  if (s === 'likes') renderLikes();
  if (s === 'chats') renderChats();
  if (s === 'profile') { renderProfile(); renderFilter(); }
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

// ---- Фильтр анкет ----
function candidates() {
  const f = state.filters;
  return USERS.filter(u => !state.me.seeking || u.gender === state.me.seeking)
    .filter(u => !f.city || u.city === f.city)
    .filter(u => u.age >= f.min && u.age <= f.max)
    .filter(u => !state.seen.includes(u.id));
}

// ---- Главная ----
function renderHome() {
  const box = document.getElementById('screen-home');
  const list = candidates();
  if (!list.length) {
    box.innerHTML = '<div class="empty">Анкеты закончились 🎉<br>Попробуй ослабить фильтр в профиле 👤</div>';
    return;
  }
  const u = list[0];
  box.innerHTML = `
    <div class="card">
      <div class="photo">${u.emoji}</div>
      <div class="distance">📍 ${u.km} км от тебя</div>
      <div class="info"><h2>${u.name}, ${u.age}</h2><p>${u.city} · ${u.bio}</p></div>
    </div>
    <div class="actions">
      <button class="btn-no" onclick="swipe(false)">✕</button>
      <button class="btn-yes" onclick="swipe(true)">❤</button>
    </div>`;
}

function swipe(like) {
  const u = candidates()[0];
  state.seen.push(u.id);
  if (like) {
    state.likes.push(u.id);
    if (!state.matches.includes(u.id)) state.matches.push(u.id);
    if (!state.chats[u.id]) state.chats[u.id] = [];
    openMatch(u.id);
  }
  save();
  renderHome();
}

// ---- Попап совпадения ----
let matchUserId = null;
function openMatch(id) {
  matchUserId = id;
  const u = USERS.find(x => x.id === id);
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
  const list = state.likes.map(id => USERS.find(u => u.id === id)).filter(Boolean);
  if (!list.length) {
    box.innerHTML = '<div class="empty">Пока никто не лайкнут.<br>Ставь ❤ на главной!</div>';
    return;
  }
  box.innerHTML = list.map(u => {
    const isMatch = state.matches.includes(u.id);
    return `
    <div class="person-row" onclick="${isMatch ? `openChat(${u.id})` : ''}">
      <div class="ava">${u.emoji}</div>
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
  const city = document.getElementById('flt-city').value;
  let min = +document.getElementById('flt-min').value || 18;
  let max = +document.getElementById('flt-max').value || 99;
  if (min > max) [min, max] = [max, min];
  state.me.seeking = seeking;
  state.filters = { city, min, max };
  save();
  updateFilterNote();
  showScreen('home');
}
function updateFilterNote() {
  const f = state.filters;
  const n = USERS.filter(u => u.gender === state.me.seeking)
    .filter(u => !f.city || u.city === f.city)
    .filter(u => u.age >= f.min && u.age <= f.max).length;
  document.getElementById('flt-note').textContent = `Под фильтр попадает анкет: ${n}`;
}

// ---- Профиль ----
function renderProfile() {
  const me = state.me;
  renderAva(document.getElementById('profile-ava'));
  document.getElementById('prof-name').value = me.name;
  document.getElementById('prof-age').value = me.age;
  document.getElementById('prof-city').value = me.city || '';
  document.getElementById('prof-bio').value = me.bio || '';
  document.getElementById('prof-note').textContent = '';
  updateBioCount();
  document.getElementById('photo-remove').classList.toggle('hidden', !me.photo);
  const picker = document.getElementById('ava-picker');
  picker.innerHTML = AVATARS.map(e =>
    `<span class="${!me.photo && e === me.emoji ? 'sel' : ''}" onclick="pickAva('${e}')">${e}</span>`).join('');
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

function pickAva(e) {
  state.me.emoji = e;
  state.me.photo = null;
  save();
  updateAvas();
  document.getElementById('photo-remove').classList.add('hidden');
  document.querySelectorAll('#ava-picker span').forEach(s =>
    s.classList.toggle('sel', s.textContent === e));
}

// (изменено: профиль сохраняется и в базу Supabase)
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
  state.me.name = name;
  state.me.age = age;
  state.me.city = document.getElementById('prof-city').value.trim();
  state.me.bio = bio.trim();
  save();

  if (currentUser) {
    await sb.from('profiles').upsert({
      id: currentUser.id,
      name: state.me.name,
      age: state.me.age,
      gender: state.me.gender,
      seeking: state.me.seeking,
      city: state.me.city,
      bio: state.me.bio,
      emoji: state.me.emoji
    });
  }
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
  if (currentChat === null) return;
  const u = USERS.find(x => x.id === currentChat);
  if (!u) return;
  gift = { id: null, qty: 1 };
  document.getElementById('gift-to').textContent = `Кому: ${u.name}`;
  document.getElementById('gift-qty').textContent = '1';
  document.getElementById('gift-total').textContent = 'Выберите подарок';
  document.querySelectorAll('#gift-list .gift-item').forEach(el =>
    el.classList.remove('sel'));
  document.getElementById('gift-modal').classList.remove('hidden');
}

function closeGift() {
  document.getElementById('gift-modal').classList.add('hidden');
}

function pickGift(id) {
  gift.id = id;
  document.querySelectorAll('#gift-list .gift-item').forEach(el =>
    el.classList.toggle('sel', el.dataset.id === id));
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
  document.getElementById('gift-total').textContent =
    `Итого: ${g.price * gift.qty} ₽`;
}

function sendGift() {
  if (!gift.id) return alert('Сначала выберите подарок');
  const g = GIFTS.find(x => x.id === gift.id);
  const total = g.price * gift.qty;
  const u = USERS.find(x => x.id === currentChat);

  payRub(total, `${g.emoji} ${g.name} × ${gift.qty} для ${u.name}`, () => {
    state.chats[currentChat].push({
      me: true,
      text: `${g.emoji} Подарил(а) ${u.name}: ${g.name} × ${gift.qty} (оплачено ${total} ₽)`
    });
    save();
    closeGift();
    renderChat();
    updateBadges();

    setTimeout(() => {
      const thanks = [
        `${g.emoji} Спасибо! Это мой любимый подарок! 💜`,
        `${g.emoji} Ого, как мило! Спасибо 💜`,
        `${g.emoji} Вы меня балуете! Спасибо 😊`
      ];
      state.chats[currentChat].push({ me: false, text: thanks[Math.floor(Math.random() * thanks.length)] });
      save();
      if (currentChat !== null) renderChat();
      updateBadges();
    }, 1200);
  });
}

// ---- Чаты ----
function renderChats() {
  const box = document.getElementById('chats-list');
  const list = state.matches.map(id => USERS.find(u => u.id === id)).filter(Boolean);
  if (!list.length) {
    box.innerHTML = '<div class="empty">Пока пусто. Ставьте ❤ на главной!</div>';
    return;
  }
  box.innerHTML = list.map(u => {
    const msgs = state.chats[u.id] || [];
    const last = msgs.length ? msgs[msgs.length-1].text : 'Напишите первым ✍️';
    return `
    <div class="person-row" onclick="openChat(${u.id})">
      <div class="ava">${u.emoji}</div>
      <div><div class="name">${u.name}, ${u.age}</div>
      <div class="sub">${last.length > 28 ? last.slice(0, 28) + '…' : last}</div></div>
    </div>`;
  }).join('');
}

function openChat(id) {
  currentChat = id;
  showScreen('chat');
  const u = USERS.find(x => x.id === id);
  document.getElementById('chat-ava').textContent = u.emoji;
  document.getElementById('chat-name').textContent = u.name;
  document.getElementById('chat-age').textContent = u.city;
  renderChat();
  updateCoinsUI();
}

function renderChat() {
  const box = document.getElementById('chat-box');
  box.innerHTML = state.chats[currentChat].map(m =>
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

// ---- Старт (изменено: проверяем сессию Supabase) ----
(async () => {
  const { data } = await sb.auth.getSession();
  const session = data && data.session;
  if (session) {
    currentUser = session.user;
    state = loadStateForUser();
    if (!state || !state.me) {
      const { data: p } = await sb.from('profiles').select('*').eq('id', currentUser.id).maybeSingle();
      state = defaultState();
      if (p) {
        state.me = {
          name: p.name || 'Без имени',
          age: p.age || 18,
          gender: p.gender || 'f',
          seeking: p.seeking || 'f',
          city: p.city || '',
          bio: p.bio || '',
          emoji: p.emoji || '🙂',
          photo: null
        };
      }
    }
    if (state.me) enterApp();
  }
})();
