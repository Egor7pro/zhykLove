// ---- Supabase ----
const SUPA_URL = 'https://oxykfzxszgfjkyyzjudz.supabase.co';
const SUPA_KEY = 'sb_publishable_pMoqaaTItSB1tnrKCsBK-A_92rSvWd1';
const sb = supabase.createClient(SUPA_URL, SUPA_KEY);
let currentUser = null;

// Анкеты из базы
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
    city: p.city || 'Не указан',
    bio: p.bio || '',
    gender: p.gender,
    photo: p.photo || null
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
    return `<img src="${u.photo}" alt="Аватар">`;
  }
  return avaInitial(u.name);
}

// ---- Настройки ----
const PHOTO_MAX = 400;

// ---- Состояние ----
const STATE_VERSION = 19;

function stateKey() {
  return 'zhyklove_v' + STATE_VERSION + '_' + (currentUser ? currentUser.id : 'guest');
}

function defaultState() {
  return {
    me: null,
    seen: [],        // анкеты, которые уже листал в ленте
    likedSeen: [],   // входящие лайки, решение по которым уже принято
    matches: [],     // взаимные лайки
    chats: {}
  };
}

function defaultMe() {
  return {
    name: '', age: 18, gender: 'f',
    country: 'Россия', city: '',
    bio: '', photo: null,
    prefMin: 18, prefMax: 99   // выбранный возраст партнёра
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
    s.seen = (s.seen || []).map(String);
    s.likedSeen = (s.likedSeen || []).map(String);
    s.matches = (s.matches || []).map(String);
    return s;
  } catch { return null; }
}

const save = () => localStorage.setItem(stateKey(), JSON.stringify(state));
let currentChat = null;

// Сообщения текущего чата (приходят из базы)
let chatMessages = [];
let chatChannel = null;

// Подписка на входящие лайки в реальном времени
let likesChannel = null;

// Входящие лайки (кто лайкнул меня и ждёт решения)
let incomingLikes = [];

// Отложенное действие: регистрируемся, чтобы продолжить лайк/сообщение
let pendingAction = null;

// ---- Поиск анкеты по id (строковое сравнение) ----
function findPerson(id) {
  return dbProfiles.find(x => String(x.id) === String(id));
}

// ---- Экраны входа/регистрации/приветствия ----
function showAuthForm(which) {
  document.getElementById('welcome-fields').classList.toggle('hidden', which !== 'welcome');
  document.getElementById('reg-fields').classList.toggle('hidden', which !== 'reg');
  document.getElementById('login-fields').classList.toggle('hidden', which !== 'login');

  const regNote = document.getElementById('reg-note-top');
  const loginNote = document.getElementById('login-note-top');
  if (regNote) regNote.textContent = (which === 'reg' && pendingAction)
    ? 'Чтобы продолжить, создайте аккаунт — это займёт полминуты' : '';
  if (loginNote) loginNote.textContent = (which === 'login' && pendingAction)
    ? 'Войдите, чтобы продолжить' : '';
}

// Гостевой режим: смотрим ленту без аккаунта
function enterAsGuest() {
  currentUser = null;
  state = defaultState();
  document.getElementById('reg-screen').classList.add('hidden');
  document.getElementById('nav').classList.remove('hidden');
  document.getElementById('header').classList.remove('hidden');
  showScreen('home');
}

// Барьер регистрации: лайк гостя → форма регистрации, лента прячется
function openAuthGate(action) {
  pendingAction = action || null;

  // Лента, шапка и нижняя панель исчезают — остаётся только форма
  document.getElementById('nav').classList.add('hidden');
  document.getElementById('header').classList.add('hidden');
  ['home','likes','chats','chat','live','profile'].forEach(x =>
    document.getElementById('screen-' + x).classList.add('hidden'));

  document.getElementById('reg-screen').classList.remove('hidden');
  showAuthForm('reg');
}

// Спрятать экран входа/регистрации
function hideAuthScreen() {
  document.getElementById('reg-screen').classList.add('hidden');
}

// После регистрации/входа: выполнить то, ради чего человек регистрировался
async function runPendingAction() {
  const action = pendingAction;
  pendingAction = null;

  if (!action) {
    // Новичку сразу открываем анкету — пусть заполнит
    showScreen('profile');
    const note = document.getElementById('prof-note');
    if (note) note.textContent = 'Добро пожаловать! Заполните анкету — имя, возраст и город';
    return;
  }

  if (action.type === 'like' && action.id) {
    await doLike(action.id);
    return;
  }

  if (action.type === 'message' && action.text && currentChat) {
    const ok = await insertMessage(action.text);
    if (ok) document.getElementById('chat-input').value = '';
  }
}

// ---- Аватар: фото или первая буква имени ----
function renderAva(element) {
  if (!state.me) { element.textContent = '?'; return; }
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

// ---- Регистрация: только почта и пароль ----
async function register() {
  const email = document.getElementById('reg-email').value.trim();
  const pass = document.getElementById('reg-pass').value;
  const pass2 = document.getElementById('reg-pass2').value;

  if (!email || !email.includes('@')) return alert('Укажите корректный email');
  if (pass.length < 6) return alert('Пароль — минимум 6 символов');
  if (pass !== pass2) return alert('Пароли не совпадают');

  const { data, error } = await sb.auth.signUp({ email, password: pass });
  if (error) return alert('Ошибка регистрации: ' + error.message);

  if (!data.session) {
    return alert('Письмо с подтверждением отправлено на ' + email +
      '. Подтвердите почту и войдите через кнопку «Войти».');
  }

  currentUser = data.user;

  state = defaultState();
  state.me = Object.assign(defaultMe(), { name: email.split('@')[0] });
  save();

  await saveProfileToDb();
  await loadProfiles();
  await loadIncomingLikes();

  // Сразу в приложение — без экрана входа
  hideAuthScreen();
  enterApp();
  await runPendingAction();
}

// ---- Вход: только почта и пароль (после выхода из аккаунта) ----
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
      country: p.country || 'Россия',
      city: p.city || '',
      bio: p.bio || '',
      photo: p.photo || null
    } : { name: email.split('@')[0] });
  }
  save();
  await loadProfiles();
  await loadIncomingLikes();

  hideAuthScreen();
  enterApp();
  await runPendingAction();
}

function enterApp() {
  document.getElementById('reg-screen').classList.add('hidden');
  document.getElementById('nav').classList.remove('hidden');
  document.getElementById('header').classList.remove('hidden');
  updateAvas();
  document.getElementById('photo-remove').classList.toggle('hidden', !state.me.photo);
  showScreen('home');
  subscribeLikes();
}

// ---- Выход ----
function logout() {
  if (!confirm('Точно выйти? Лайки будут удалены.')) return;
  leaveLive();
  closeLiveIndex();
  if (chatChannel) { sb.removeChannel(chatChannel); chatChannel = null; }
  if (likesChannel) { sb.removeChannel(likesChannel); likesChannel = null; }
  sb.auth.signOut();
  localStorage.removeItem(stateKey());
  currentUser = null;
  state = defaultState();
  dbProfiles = [];
  incomingLikes = [];

  // Возврат на приветственный экран — вход понадобится при следующем визите
  document.getElementById('nav').classList.add('hidden');
  document.getElementById('header').classList.add('hidden');
  ['home','likes','chats','chat','live','profile'].forEach(x =>
    document.getElementById('screen-' + x).classList.add('hidden'));
  document.getElementById('reg-screen').classList.remove('hidden');
  showAuthForm('welcome');
}

// ---- Навигация ----
function showScreen(s) {
  // Гость: доступна только лента — остальные кнопки нижней панели не срабатывают
  if (!currentUser && s !== 'home') return;

  ['home','likes','chats','chat','live','profile'].forEach(x =>
    document.getElementById('screen-' + x).classList.toggle('hidden', x !== s));
  ['home','likes','chats','live','profile'].forEach(x => {
    const b = document.getElementById('nav-' + x);
    if (b) b.classList.toggle('active', x === s);
  });
  if (s === 'home') loadProfiles().then(renderHome);
  if (s === 'likes') renderLikes();
  if (s === 'chats') renderChats();
  if (s === 'live') { if (!liveIndexChannel) openLiveIndex(); }
  if (s === 'profile') renderProfile();
  updateBadges();
}

function updateBadges() {
  const lb = document.getElementById('likes-badge');
  if (incomingLikes.length) { lb.textContent = incomingLikes.length; lb.classList.remove('hidden'); }
  else lb.classList.add('hidden');
  const cb = document.getElementById('chats-badge');
  const unread = Object.values(state.chats).reduce((n, msgs) => n + (msgs.length && !msgs[msgs.length-1].me ? 1 : 0), 0);
  if (unread) { cb.textContent = unread; cb.classList.remove('hidden'); }
  else cb.classList.add('hidden');
}

// ---- Лайки в базе ----

// Поставить лайк человеку. Если он уже лайкнул тебя — это взаимно.
async function likeUser(targetId) {
  targetId = String(targetId);

  // Лайкать самого себя нельзя
  if (currentUser && targetId === String(currentUser.id)) return false;

  const { error } = await sb.from('likes').insert({
    liker_id: currentUser.id,
    liked_id: targetId
  });
  if (error) {
    // уникальный индекс: лайк уже был — это не ошибка для пользователя
    if (!String(error.message).includes('duplicate')) {
      console.error('ОШИБКА лайка:', error.message);
      alert('Лайк не сохранился: ' + error.message);
      return false;
    }
  }

  // Проверяем: он уже лайкал меня?
  const { data: back } = await sb.from('likes')
    .select('*')
    .eq('liker_id', targetId)
    .eq('liked_id', currentUser.id)
    .maybeSingle();

  if (back) {
    if (!state.matches.includes(targetId)) {
      state.matches.push(targetId);
      if (!state.chats[targetId]) state.chats[targetId] = [];
    }
  }

  save();
  updateBadges();
  return !!back; // true — это взаимный лайк
}

// Загрузить входящие лайки (кто лайкнул меня, по кому решения ещё нет)
async function loadIncomingLikes() {
  const { data, error } = await sb.from('likes')
    .select('liker_id')
    .eq('liked_id', currentUser.id);
  if (error) {
    console.error('ОШИБКА загрузки лайков:', error.message);
    incomingLikes = [];
    return;
  }
  incomingLikes = (data || [])
    .map(l => String(l.liker_id))
    .filter(id => !state.likedSeen.includes(id) && !state.matches.includes(id) && id !== currentUser.id);
  updateBadges();
}

// Мгновенное уведомление о новых лайках
function subscribeLikes() {
  if (!currentUser) return;
  if (likesChannel) { sb.removeChannel(likesChannel); likesChannel = null; }
  likesChannel = sb.channel('likes-' + currentUser.id)
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'likes', filter: `liked_id=eq.${currentUser.id}` },
      async (payload) => {
        const likerId = String(payload.new.liker_id);
        await loadIncomingLikes();
        const u = findPerson(likerId);
        if (u && incomingLikes.includes(likerId)) {
          alert(`💜 Тебя лайкнул ${u.name}! Открой раздел ❤️ и реши: лайкнуть в ответ или пройти мимо.`);
        }
      })
    .subscribe();
}

// Принять или отклонить входящий лайк
async function decideLike(likerId, accept) {
  likerId = String(likerId);
  if (!state.likedSeen.includes(likerId)) state.likedSeen.push(likerId);
  incomingLikes = incomingLikes.filter(id => id !== likerId);

  if (accept) {
    const mutual = await likeUser(likerId);
    if (mutual) {
      openMatch(likerId);
      save();
      renderLikes();
      return;
    }
  }
  save();
  renderLikes();
}

// ---- Лента анкет ----

// Отбрасываем свою анкету
function allPeople() {
  const myId = currentUser && currentUser.id;
  return dbProfiles.filter(p => p.id !== myId);
}

// Кого показывать в ленте:
// - гость: все анкеты
// - зарегистрированный: противоположный пол, та же страна, тот же город,
//   возраст в выбранном диапазоне
function candidates() {
  const list = allPeople()
    .filter(u => u.id && !state.seen.includes(String(u.id)));

  const me = state.me;
  if (!me) return list;

  const myCountry = (me.country || '').trim().toLowerCase();
  const myCity = (me.city || '').trim().toLowerCase();
  const min = Math.min(me.prefMin || 18, me.prefMax || 99);
  const max = Math.max(me.prefMin || 18, me.prefMax || 99);

  return list.filter(u => {
    // противоположный пол
    if (!u.gender || u.gender === me.gender) return false;
    // та же страна
    if (myCountry && (u.country || '').trim().toLowerCase() !== myCountry) return false;
    // тот же город
    if (myCity && (u.city || '').trim().toLowerCase() !== myCity) return false;
    // возраст в выбранном диапазоне
    if (u.age < min || u.age > max) return false;
    return true;
  });
}

// Поставить лайк конкретному человеку (используется и после регистрации)
async function doLike(id) {
  if (currentUser && String(id) === String(currentUser.id)) {
    renderHome();
    return;
  }

  const mutual = await likeUser(id);
  renderHome();
  if (mutual) {
    openMatch(id);
    return;
  }
  const u = findPerson(id);
  if (u) alert('Лайк отправлен! Если ' + u.name + ' лайкнет тебя в ответ — получите матч 💜');
}

// ---- Главная ----
function renderHome() {
  const box = document.getElementById('screen-home');
  const list = candidates();
  if (!list.length) {
    const hint = currentUser
      ? 'В твоём городе подходящих анкет пока нет.<br>Проверь страну и город в профиле — и заглядывай позже!'
      : 'Анкеты закончились 🎉';
    box.innerHTML = `
      <div class="empty">${hint}</div>
      <button class="btn-main" style="margin-top:16px" onclick="restartFeed()">🔄 Смотреть заново</button>`;
    return;
  }
  const u = list[0];
  box.innerHTML = `
    <div class="card">
      <div class="photo">${personAvaHtml(u)}</div>
      <div class="info"><h2>${u.name}, ${u.age}</h2><p>${u.city} · ${u.bio}</p></div>
    </div>
    <div class="actions">
      <button class="btn-no" onclick="swipe(false)">✕</button>
      <button class="btn-yes" onclick="swipe(true)">❤</button>
    </div>`;
}

async function swipe(like) {
  const u = candidates()[0];
  if (!u) return;

  // Зарегистрированный пользователь не может лайкнуть свою анкету
  if (like && currentUser && String(u.id) === String(currentUser.id)) {
    state.seen.push(String(u.id));
    save();
    renderHome();
    return;
  }

  // Гость жмёт лайк → анкета уходит в «просмотренные»,
  // лента прячется и открывается форма регистрации
  if (like && !currentUser) {
    state.seen.push(String(u.id));
    save();
    openAuthGate({ type: 'like', id: String(u.id) });
    return;
  }

  state.seen.push(String(u.id));

  if (like) {
    const mutual = await likeUser(u.id);
    if (mutual) {
      save();
      renderHome();
      openMatch(u.id);
      return;
    }
    save();
    renderHome();
    alert('Лайк отправлен! Если ' + u.name + ' лайкнет тебя в ответ — получите матч 💜');
    return;
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
  if (!u) return;
  document.getElementById('match-text').textContent = 'Вы с ' + u.name + ' лайкнули друг друга! Напишите первым 😉';
  document.getElementById('match-modal').classList.remove('hidden');
}
function closeMatch(gotoChat) {
  document.getElementById('match-modal').classList.add('hidden');
  if (gotoChat && matchUserId !== null) openChat(matchUserId);
  matchUserId = null;
}

// ---- Лайкнутые / входящие лайки ----
async function renderLikes() {
  if (!currentUser) return;
  await loadIncomingLikes();

  const box = document.getElementById('likes-list');
  const matches = state.matches.map(id => findPerson(id)).filter(Boolean);
  const incoming = incomingLikes.map(id => findPerson(id)).filter(Boolean);

  let html = '';

  if (incoming.length) {
    html += '<div class="likes-title">Тебя лайкнули — реши, что ответить:</div>';
    html += incoming.map(u => `
      <div class="person-row">
        <div class="ava">${personAvaHtml(u)}</div>
        <div><div class="name">${u.name}, ${u.age}</div>
        <div class="sub">${u.city}</div></div>
        <div class="like-decide">
          <button class="btn-decide yes" onclick="decideLike('${u.id}', true)">❤</button>
          <button class="btn-decide no" onclick="decideLike('${u.id}', false)">✕</button>
        </div>
      </div>`).join('');
  }

  if (matches.length) {
    html += '<div class="likes-title">Взаимно 💜 — можно писать:</div>';
    html += matches.map(u => `
      <div class="person-row" onclick="openChat('${u.id}')">
        <div class="ava">${personAvaHtml(u)}</div>
        <div><div class="name">${u.name}, ${u.age}</div>
        <div class="sub">${u.city}</div></div>
        <div class="tag match">Матч</div>
      </div>`).join('');
  }

  if (!html) {
    html = '<div class="empty">Пока никого.<br>Ставь ❤ на главной — и проверяй этот экран: когда тебя лайкнут, уведомление появится здесь ❤</div>';
  }

  box.innerHTML = html;
  updateBadges();
}

// ---- Профиль ----
function renderProfile() {
  const me = state.me;
  if (!me) return;
  renderAva(document.getElementById('profile-ava'));
  document.getElementById('prof-name').value = me.name;
  document.getElementById('prof-age').value = me.age;
  document.getElementById('prof-country').value = me.country || 'Россия';
  document.getElementById('prof-city').value = me.city || '';
  document.getElementById('prof-gender').value = me.gender;
  document.getElementById('pref-min').value = me.prefMin || 18;
  document.getElementById('pref-max').value = me.prefMax || 99;
  document.getElementById('prof-bio').value = me.bio || '';
  document.getElementById('prof-note').textContent = '';
  updateBioCount();
  document.getElementById('photo-remove').classList.toggle('hidden', !me.photo);
  document.getElementById('stat-likes').textContent = incomingLikes.length;
  document.getElementById('stat-matches').textContent = state.matches.length;
  document.getElementById('stat-chats').textContent = Object.keys(state.chats).filter(k => state.chats[k].length).length;
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
    country: me.country,
    city: me.city,
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

  let prefMin = +document.getElementById('pref-min').value || 18;
  let prefMax = +document.getElementById('pref-max').value || 99;
  if (prefMin < 18) prefMin = 18;
  if (prefMax > 99) prefMax = 99;
  if (prefMin > prefMax) [prefMin, prefMax] = [prefMax, prefMin];

  const me = state.me;
  me.name = name;
  me.age = age;
  me.country = document.getElementById('prof-country').value;
  me.city = document.getElementById('prof-city').value.trim();
  me.gender = document.getElementById('prof-gender').value;
  me.bio = bio.trim();
  me.prefMin = prefMin;
  me.prefMax = prefMax;
  save();

  await saveProfileToDb();
  await loadProfiles();
  updateAvas();
  document.getElementById('prof-note').textContent = 'Профиль сохранён ✅';

  // Возвращаемся в ленту с новым подбором
  state.seen = [];
  save();
  showScreen('home');
}

document.getElementById('prof-bio').addEventListener('input', updateBioCount);
document.getElementById('photo-input').addEventListener('change', handlePhoto);

// ---- Чаты ----
function renderChats() {
  const box = document.getElementById('chats-list');
  const list = state.matches.map(id => findPerson(id)).filter(Boolean);
  if (!list.length) {
    box.innerHTML = '<div class="empty">Пока пусто. Взаимные лайки появятся в чатах!</div>';
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

async function openChat(id) {
  if (!currentUser) return;
  // Чат с самим собой невозможен
  if (String(id) === String(currentUser.id)) return;
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

  await loadChatMessages();
  subscribeToChat();
}

// Загрузка переписки из базы
async function loadChatMessages() {
  const myId = currentUser.id;
  const { data, error } = await sb.from('messages')
    .select('*')
    .or(`and(sender_id.eq.${myId},receiver_id.eq.${currentChat}),and(sender_id.eq.${currentChat},receiver_id.eq.${myId})`)
    .order('created_at', { ascending: true });
  if (error) {
    console.error('ОШИБКА загрузки сообщений:', error.message);
    chatMessages = [];
    renderChat();
    return;
  }
  chatMessages = (data || []).map(m => ({
    me: m.sender_id === myId,
    text: m.text
  }));
  renderChat();
}

// Подписка на новые сообщения в реальном времени
function subscribeToChat() {
  if (chatChannel) { sb.removeChannel(chatChannel); chatChannel = null; }
  chatChannel = sb.channel('chat-' + currentChat)
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages', filter: `receiver_id=eq.${currentUser.id}` },
      (payload) => {
        const msg = payload.new;
        if (String(msg.sender_id) === String(currentChat)) {
          chatMessages.push({ me: false, text: msg.text });
          renderChat();
        }
      })
    .subscribe();
}

async function insertMessage(text) {
  const { error } = await sb.from('messages').insert({
    sender_id: currentUser.id,
    receiver_id: currentChat,
    text: text
  });
  if (error) {
    console.error('ОШИБКА отправки:', error.message);
    alert('Сообщение не отправилось: ' + error.message);
    return false;
  }
  chatMessages.push({ me: true, text });
  state.chats[currentChat] = [{ me: true, text }];
  save();
  renderChat();
  return true;
}

function renderChat() {
  const box = document.getElementById('chat-box');
  box.innerHTML = chatMessages.map(m =>
    `<div class="msg ${m.me ? 'me' : 'them'}">${m.text}</div>`).join('');
  box.scrollTop = box.scrollHeight;
}

async function sendMessage() {
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (!text || currentChat === null) return;

  // Не зарегистрирован → форма регистрации, потом сообщение уйдёт само
  if (!currentUser) {
    openAuthGate({ type: 'message', text: text });
    return;
  }

  const ok = await insertMessage(text);
  if (ok) input.value = '';
}

document.getElementById('chat-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') sendMessage();
});

// ---- Прямой эфир (WebRTC + Supabase Realtime) ----
// Ведущий публикует камеру, зрители смотрят напрямую у ведущего (mesh).
// Чат эфира: общий и одноразовый — история не сохраняется.
// Пишут только зрители, ведущий читает.
const RTC_CFG = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

let liveIndexChannel = null;   // общий канал со списком эфиров (presence)
let liveChannel = null;        // сигналинг-канал текущего эфира
let liveRole = null;           // 'host' | 'viewer'
let liveRoom = null;           // id ведущего
let liveStream = null;         // локальная камера ведущего
const hostPcs = new Map();     // ведущий: viewerId -> RTCPeerConnection
const hostIceQueues = new Map(); // ведущий: viewerId -> очередь ICE-кандидатов
let viewerPc = null;           // зритель: одно подключение
let viewerIceQueue = [];       // очередь ICE-кандидатов зрителя
let viewerConnected = false;   // подключился ли зритель к видео
let helloTimer = null;         // повторные запросы подключения зрителя

// Очередь ICE: кандидат применяется сразу, если подключение готово,
// иначе ждёт в очереди — так ничего не теряется
function pushIce(pc, queue, cand) {
  if (pc && pc.remoteDescription) {
    pc.addIceCandidate(cand).catch(console.error);
  } else {
    queue.push(cand);
  }
}

function flushIce(pc, queue) {
  if (!pc) return;
  queue.forEach(c => pc.addIceCandidate(c).catch(console.error));
  queue.length = 0;
}

function openLiveIndex() {
  liveIndexChannel = sb.channel('live-index', { config: { presence: { key: currentUser.id } } });
  liveIndexChannel
    .on('presence', { event: 'sync' }, () => {
      renderLiveList(liveIndexChannel.presenceState());
    })
    .subscribe();
}

function closeLiveIndex() {
  if (liveIndexChannel) { sb.removeChannel(liveIndexChannel); liveIndexChannel = null; }
}

function renderLiveList(presenceState) {
  const box = document.getElementById('live-list');
  if (!box) return;
  const hosts = [];
  Object.values(presenceState).forEach(arr => {
    (arr || []).forEach(meta => {
      if (meta && meta.id && meta.id !== currentUser.id && !hosts.some(h => h.id === meta.id)) {
        hosts.push(meta);
      }
    });
  });
  if (!hosts.length) {
    box.innerHTML = '<div class="empty">Сейчас никто не в эфире.<br>Стань первым — жми «Начать эфир»! 🔴</div>';
    return;
  }
  box.innerHTML = hosts.map(h => `
    <div class="person-row">
      <div class="ava">${h.photo ? `<img src="${h.photo}" alt="Аватар">` : avaInitial(h.name)}</div>
      <div><div class="name">${h.name}</div><div class="sub">🔴 в эфире</div></div>
      <button class="btn-live-watch" onclick="watchLive('${h.id}')">Смотреть</button>
    </div>`).join('');
}

async function startLive() {
  if (liveRole) return alert('Ты уже в эфире');
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    return alert('Браузер не поддерживает камеру. Нужен HTTPS и современный браузер.');
  }
  try {
    liveStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  } catch (e) {
    return alert('Не удалось включить камеру/микрофон: ' + e.message);
  }
  liveRole = 'host';
  liveRoom = currentUser.id;

  const v = document.getElementById('live-video');
  v.srcObject = liveStream;
  v.muted = true; // свой звук не слушаем
  v.play().catch(() => {});

  joinSignaling(liveRoom);
  if (liveIndexChannel) liveIndexChannel.track({ id: currentUser.id, name: state.me.name, photo: state.me.photo });

  document.getElementById('btn-start-live').classList.add('hidden');
  document.getElementById('live-list').classList.add('hidden');
  document.getElementById('live-video-wrap').classList.remove('hidden');
  document.getElementById('live-status').textContent = '🔴 В эфире · ты ведущий';
  document.getElementById('live-chat-box').innerHTML = '';

  // Ведущий только читает чат — ввод скрыт
  const chatRow = document.getElementById('live-chat-row');
  if (chatRow) chatRow.classList.add('hidden');
}

async function watchLive(broadcasterId) {
  if (liveRole) return alert('Сначала выйди из текущего эфира');
  liveRole = 'viewer';
  liveRoom = String(broadcasterId);
  viewerConnected = false;
  viewerIceQueue = [];

  document.getElementById('btn-start-live').classList.add('hidden');
  document.getElementById('live-list').classList.add('hidden');
  document.getElementById('live-video-wrap').classList.remove('hidden');
  document.getElementById('live-status').textContent = '⏳ Подключаемся к эфиру...';
  document.getElementById('live-chat-box').innerHTML = '';

  // Зритель может писать в общий чат
  const chatRow = document.getElementById('live-chat-row');
  if (chatRow) chatRow.classList.remove('hidden');

  joinSignaling(liveRoom);

  // если за 40 секунд так и не подключились — сообщаем
  setTimeout(() => {
    if (liveRole === 'viewer' && !viewerConnected) {
      document.getElementById('live-status').textContent = 'Эфир недоступен — возможно, ведущий уже закончил';
    }
  }, 40000);
}

function joinSignaling(room) {
  liveChannel = sb.channel('live-' + room, { config: { presence: { key: currentUser.id } } });

  // Чат эфира: слушают все — и ведущий, и зрители.
  // Своё сообщение отправитель дорисовывает локально (broadcast не эхоится себе).
  liveChannel
    .on('broadcast', { event: 'chat' }, ({ payload }) => {
      if (payload.from === currentUser.id) return;
      renderLiveChat(payload.name || 'Гость', payload.text, false);
    });

  if (liveRole === 'host') {
    liveChannel
      .on('broadcast', { event: 'hello' }, ({ payload }) => onViewerHello(payload))
      .on('broadcast', { event: 'answer' }, ({ payload }) => onViewerAnswer(payload))
      .on('broadcast', { event: 'ice' }, ({ payload }) => onLiveIce(payload))
      .subscribe();
  } else {
    liveChannel
      .on('broadcast', { event: 'offer' }, ({ payload }) => onHostOffer(payload))
      .on('broadcast', { event: 'ice' }, ({ payload }) => onLiveIce(payload))
      .subscribe(status => {
        if (status === 'SUBSCRIBED') sendHello();
      });

    // Повторяем запрос подключения каждые 2 секунды, пока видео не пойдёт —
    // на случай, если первый «hello» потерялся
    helloTimer = setInterval(() => {
      if (liveRole === 'viewer' && !viewerConnected) sendHello();
    }, 2000);
  }
}

function sendHello() {
  if (liveChannel && liveRole === 'viewer') {
    liveChannel.send({ type: 'broadcast', event: 'hello', payload: { from: currentUser.id } });
  }
}

// --- Ведущий: новый зритель ---
async function onViewerHello(p) {
  if (liveRole !== 'host' || !liveStream) return;

  let pc = hostPcs.get(p.from);
  if (!pc) {
    pc = new RTCPeerConnection(RTC_CFG);
    hostPcs.set(p.from, pc);
    hostIceQueues.set(p.from, []);
    liveStream.getTracks().forEach(t => pc.addTrack(t, liveStream));
    pc.onicecandidate = e => {
      if (e.candidate) liveChannel.send({ type: 'broadcast', event: 'ice', payload: { to: p.from, cand: e.candidate } });
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        hostPcs.delete(p.from);
        hostIceQueues.delete(p.from);
      }
    };
  }

  // Пересоздаём offer (важно, если зритель прислал hello повторно)
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  liveChannel.send({ type: 'broadcast', event: 'offer', payload: { to: p.from, sdp: pc.localDescription } });
}

// --- Ведущий: ответ зрителя ---
async function onViewerAnswer(p) {
  if (liveRole !== 'host') return;
  const pc = hostPcs.get(p.from);
  if (!pc) return;
  await pc.setRemoteDescription(new RTCSessionDescription(p.sdp));
  flushIce(pc, hostIceQueues.get(p.from) || []);
}

// --- Зритель: предложение от ведущего ---
async function onHostOffer(p) {
  if (liveRole !== 'viewer' || p.to !== currentUser.id) return;

  if (viewerPc) { viewerPc.close(); viewerPc = null; }

  viewerPc = new RTCPeerConnection(RTC_CFG);
  viewerPc.ontrack = e => {
    viewerConnected = true;
    if (helloTimer) { clearInterval(helloTimer); helloTimer = null; }
    const v = document.getElementById('live-video');
    v.srcObject = e.streams[0];
    v.muted = false;
    v.play().catch(() => {});
    document.getElementById('live-status').textContent = '🔴 Эфир идёт';
  };
  viewerPc.onicecandidate = e => {
    if (e.candidate) {
      liveChannel.send({
        type: 'broadcast', event: 'ice',
        payload: { to: liveRoom, from: currentUser.id, cand: e.candidate }
      });
    }
  };

  await viewerPc.setRemoteDescription(new RTCSessionDescription(p.sdp));
  flushIce(viewerPc, viewerIceQueue);

  const ans = await viewerPc.createAnswer();
  await viewerPc.setLocalDescription(ans);
  liveChannel.send({ type: 'broadcast', event: 'answer', payload: { from: currentUser.id, sdp: viewerPc.localDescription } });
}

// --- ICE-кандидаты: адресация и очереди ---
function onLiveIce(p) {
  if (liveRole === 'host') {
    if (p.to !== currentUser.id) return;
    let queue = hostIceQueues.get(p.from);
    if (!queue) { queue = []; hostIceQueues.set(p.from, queue); }
    pushIce(hostPcs.get(p.from), queue, p.cand);
  } else if (liveRole === 'viewer') {
    if (p.to !== currentUser.id) return;
    pushIce(viewerPc, viewerIceQueue, p.cand);
  }
}

// --- Чат эфира: общий, пишут только зрители ---
function sendLiveChat() {
  // Ведущий писать не может
  if (liveRole !== 'viewer') return;
  const input = document.getElementById('live-chat-input');
  const text = input.value.trim();
  if (!text || !liveChannel) return;
  liveChannel.send({
    type: 'broadcast', event: 'chat',
    payload: { from: currentUser.id, name: state.me.name, text }
  });
  // своё сообщение показываем сразу — broadcast не возвращается отправителю
  renderLiveChat(state.me.name, text, true);
  input.value = '';
}

function renderLiveChat(name, text, me) {
  const box = document.getElementById('live-chat-box');
  if (!box) return;
  const div = document.createElement('div');
  div.className = 'live-chat-msg' + (me ? ' me' : '');
  div.innerHTML = `<b>${name}:</b> ${text}`;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

document.getElementById('live-chat-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') sendLiveChat();
});

// --- Выход из эфира ---
async function leaveLive() {
  if (liveRole === 'host') {
    if (liveIndexChannel) liveIndexChannel.untrack();
    hostPcs.forEach(pc => pc.close());
    hostPcs.clear();
    hostIceQueues.clear();
    if (liveStream) { liveStream.getTracks().forEach(t => t.stop()); liveStream = null; }
  }
  if (liveRole === 'viewer') {
    if (viewerPc) { viewerPc.close(); viewerPc = null; }
  }
  if (helloTimer) { clearInterval(helloTimer); helloTimer = null; }
  if (liveChannel) { sb.removeChannel(liveChannel); liveChannel = null; }
  liveRole = null;
  liveRoom = null;
  viewerIceQueue = [];
  viewerConnected = false;

  const v = document.getElementById('live-video');
  if (v) v.srcObject = null;

  const chatRow = document.getElementById('live-chat-row');
  if (chatRow) chatRow.classList.remove('hidden');

  const wrap = document.getElementById('live-video-wrap');
  if (wrap) wrap.classList.add('hidden');
  const list = document.getElementById('live-list');
  if (list) list.classList.remove('hidden');
  const btn = document.getElementById('btn-start-live');
  if (btn) btn.classList.remove('hidden');
}

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
        country: p.country || 'Россия',
        city: p.city || '',
        bio: p.bio || '',
        photo: p.photo || null
      } : { name: 'Без имени' });
    }
    await loadIncomingLikes();
    if (state.me) enterApp();
  }
  // Если сессии нет — остаётся приветственный экран
})();
