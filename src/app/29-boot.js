// ==================== BOOT ====================
// Persist anything normalizeDB() had to repair on load, then draw.
saveDB();
// Open on whatever section the address asks for, so a bookmarked or shared
// #/products link lands on products instead of always on the dashboard.
currentTab = tabFromHash();
render();
