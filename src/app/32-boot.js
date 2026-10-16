// ==================== BOOT ====================
// Persist anything normalizeDB() had to repair on load, then draw.
saveDB();
// Open on whatever section the address asks for, so a bookmarked or shared
// #/products link lands on products instead of always on the dashboard.
currentTab = tabFromHash();
render();
// Signed-in devices (and a return from Google) pick up their session in the
// background; the screen above is already drawn from this device's copy.
cloudBoot().catch((e) => console.warn("Cloud start-up failed:", e));
