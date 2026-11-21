// Списки слов: "Все слова", списки из столбца "Список", "Без списка".
const ALL = '__all__';
const NONE = '__none__';

function listNames(cards) {
  const names = [];
  for (const c of cards) for (const l of c.lists || []) if (!names.includes(l)) names.push(l);
  return names;
}

function hasUnlisted(cards) {
  return cards.some((c) => !c.lists || !c.lists.length);
}

// Пункты меню в порядке показа: все, списки по порядку появления, без списка.
function menuItems(cards) {
  const items = [ALL, ...listNames(cards)];
  if (hasUnlisted(cards) && items.length > 1) items.push(NONE);
  return items;
}

function cardsFor(cards, name) {
  if (name === ALL) return cards;
  if (name === NONE) return cards.filter((c) => !c.lists || !c.lists.length);
  return cards.filter((c) => (c.lists || []).includes(name));
}

function label(name) {
  return name === ALL ? 'Все слова' : name === NONE ? 'Без списка' : name;
}

const Lists = { ALL, NONE, listNames, menuItems, cardsFor, label };
if (typeof module !== 'undefined') module.exports = Lists;
