// ==================== APP STATE ====================
let currentTab = "dashboard";
let modalStack = []; // stack of modal-bg elements — supports nested modals (e.g. "add customer" opened from inside the doc builder)
// True while a history entry is "reserved" for the current chain of open modals.
// Lets the phone/browser back button close a popup instead of navigating the
// page away (which looked like it "reloaded the previous tab").
let modalHistoryPushed = false;
let docBuilder = null; // holds in-progress document
