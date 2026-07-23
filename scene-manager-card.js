// -------------------------------------------------------------------
// SCENE MANAGER ULTIMATE
// Version: 1.1.8
// Description: Carte de gestion de scènes avec Drag&Drop et Sync Serveur
// -------------------------------------------------------------------

// Version constant used below
const VERSION = '1.1.8';
const REGISTRY_ENTITY_ID = "sensor.scene_manager_registry";
const DEFAULT_LIVE_MODE_ENTITY_ID = "switch.scene_manager_live_mode";

// ... Le reste du code de la classe SceneManagerCard ...

console.info(
    `%c SCENE-MANAGER %c ${VERSION} `,
    'color: white; background: #03a9f4; font-weight: 700;',
    'color: #03a9f4; background: white; font-weight: 700;'
);

window.customCards = window.customCards || [];
window.customCards.push({
    type: "scene-manager-card",
    name: "Scene Manager Ultimate",
    description: "Interface tactile de gestion de scènes pour Home Assistant.",
    preview: true
});

const PRESET_ICONS = [
    "mdi:palette", "mdi:sofa", "mdi:bed", "mdi:power-sleep", "mdi:weather-sunny",
    "mdi:fire", "mdi:snowflake", "mdi:water-percent", "mdi:leaf", "mdi:heart",
    "mdi:candle", "mdi:ghost", "mdi:movie", "mdi:gamepad-variant", "mdi:book-open-variant",
    "mdi:music", "mdi:party-popper", "mdi:silverware-fork-knife", "mdi:glass-cocktail", "mdi:coffee",
    "mdi:briefcase", "mdi:laptop", "mdi:pencil", "mdi:eye-off", "mdi:chef-hat",
    "mdi:shower", "mdi:toilet", "mdi:baby-carriage", "mdi:tshirt-crew", "mdi:car",
    "mdi:circle", "mdi:circle-outline", "mdi:home-group"
];

class SceneManagerCard extends HTMLElement {
    static getConfigElement() { return document.createElement("scene-manager-editor"); }
    static getStubConfig() { return { title: "Mes Scènes", icon: "mdi:home-floor-1", show_title: true, button_style: "filled", button_shape: "rounded", scene_alignment: "left", button_width: "100px", button_height: "80px", card_background_style: 'theme', card_background_color: '#ffffff', button_bg_color: '#eeeeee', button_icon_color: '', button_text_color: '', title_style: 'normal', title_icon_color: '#000000', menu_background_style: 'theme', menu_background_color: '#ffffff', manual_lights: false, manual_rooms: [], manual_zones: '', scene_prefix: '', activation_transition: 2, auto_select_lights: true, show_empty: true, empty_text: 'Aucune scène', respect_live_mode: true, live_mode_entity: DEFAULT_LIVE_MODE_ENTITY_ID, action_source: 'card', fallback_to_scene_service: true }; }

    set hass(hass) {
        this._hass = hass;

        if (!this.shadowRoot) {
            this.attachShadow({ mode: 'open' });
            this._initElements();
        }

        if (this.content) {
            this._checkServerUpdates();

            if (this.isMenuOpen) {
                if (this.mainLightsContainer && this.mainLightsContainer.innerHTML === "") {
                    if (this.areas.length > 0) this._buildLightControls(this.editingId ? this._getSceneEntities(this.editingId) : null, this.editingId ? this._getSceneSnapshot(this.editingId) : null);
                }
                this._updateLightStates();
            }

            if (this.shouldUpdate) {
                this._updateContent();
                this.shouldUpdate = false;
            }

            this._updateLiveModeControl();
        }
    }

    setConfig(config) {
        // Determine previous show_title value for header re-render decisions
        const prevShowTitle = this.config ? this.config.show_title : undefined;
        const prevManualLights = this.config ? this.config.manual_lights : undefined;
        const prevManualZones = this.config ? this.config.manual_zones : undefined;
        const prevManualRoomsStr = this.config ? JSON.stringify(this.config.manual_rooms || null) : undefined;
        const nextManualRoomsStr = JSON.stringify((config && config.manual_rooms) || null);
        // Avoid unnecessary updates if config hasn't changed
        if (this.config && JSON.stringify(this.config) === JSON.stringify(config)) return;

        this.config = config;
        const oldFixed = this.fixedRoom;
        this.fixedRoom = config.room ? config.room.toLowerCase() : null;
        this.btnWidth = config.button_width || '100px';
        this.btnHeight = config.button_height || '80px';
        this.alignment = 'flex-start';
        if (config.scene_alignment === 'center') this.alignment = 'center';
        if (config.scene_alignment === 'right') this.alignment = 'flex-end';

        if (this.shadowRoot) {
            const list = this.shadowRoot.getElementById("sceneList");
            if (list) list.style.justifyContent = this.alignment;

            // Apply manual zones/lights config (if enabled)
            this._applyManualZonesConfig();

            if (
                oldFixed !== this.fixedRoom ||
                this.lastTitle !== config.title ||
                prevShowTitle !== config.show_title ||
                prevManualLights !== config.manual_lights ||
                prevManualZones !== config.manual_zones ||
                prevManualRoomsStr !== nextManualRoomsStr
            ) {
                this._renderHeader();
                this.lastTitle = config.title;
                if (this.fixedRoom) {
                    this.currentRoom = this.fixedRoom;
                } else {
                    this._fetchData();
                }
            }
            this.shouldUpdate = true;
            // Apply appearance variables whenever config changes
            try { this._applyAppearance(); } catch (e) { /* ignore */ }
            if (!this._hass) this._updateFakeButtons();
        }
    }

    _initElements() {
        this.currentIcon = "mdi:palette";
        this.currentColor = "#9E9E9E";
        this.isMenuOpen = false;
        this.editingId = null;
        this.dragSrcEl = null;
        this.currentRoom = this.fixedRoom || "";
        this.areas = [];
        this.entitiesRegistry = [];
        this.cachedOrder = [];
        this.cachedMeta = {};
        this._sceneIconColors = {};
        this._editingOrderSnapshot = null;
        this._editingOriginalEntityId = null;
        this.shouldUpdate = true;
        this._lastStorageUpdate = null;
        this._lastStorageRoom = null;
        this._liveModeOptimistic = null;
        this._liveModePending = false;

        this.shadowRoot.innerHTML = `
        <style>
                    ha-card { 
                        padding: 0; display: flex; flex-direction: column; 
                        background: var(--scene-manager-card-bg, none); box-shadow: var(--scene-manager-card-shadow, none); border: none;
                        font-family: var(--paper-font-body1_-_font-family);
                        border-radius: var(--scene-manager-card-radius, 12px);
                    }
          .control-bar { display: flex; align-items: center; gap: 12px; background: transparent; padding: 4px 16px 12px 16px; box-shadow: none; border: none; }
          .header-icon { --mdc-icon-size: 28px; color: var(--scene-manager-title-icon-color, var(--primary-color)); opacity: 0.9; }
          .fixed-title { flex: 1; font-size: 22px; font-weight: var(--scene-manager-title-weight, 500); letter-spacing: 0.5px; color: var(--primary-text-color); display: flex; align-items: center; font-family: var(--paper-font-headline_-_font-family); text-transform: var(--scene-manager-title-transform, none); }
          select.room-selector { flex: 1; padding: 0; font-size: 22px; font-weight: 500; letter-spacing: 0.5px; border: none; background: transparent; color: var(--primary-text-color); cursor: pointer; outline: none; font-family: var(--paper-font-headline_-_font-family); -webkit-appearance: none; -moz-appearance: none; appearance: none; }
          select.room-selector option { background-color: var(--card-background-color, #202020); color: var(--primary-text-color, #ffffff); }
          .toggle-btn { cursor: pointer; color: var(--primary-text-color); opacity: 0.6; transition: all 0.3s; background: transparent; width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; flex-shrink: 0; border: 1px solid transparent; }
          .toggle-btn:hover { background: rgba(var(--rgb-primary-color), 0.1); color: var(--primary-color); opacity: 1; }
          .toggle-btn.active { background: rgba(255, 0, 0, 0.1); color: #f44336; opacity: 1; transform: rotate(0deg); }
          .toggle-btn.save-mode { background: #4CAF50; color: white; opacity: 1; box-shadow: 0 2px 8px rgba(76, 175, 80, 0.4); }
          .scene-list { display: flex; gap: var(--scene-manager-btn-spacing, 12px); overflow-x: auto; padding: 4px 16px 25px 16px; scroll-behavior: smooth; scrollbar-width: none; min-height: calc(${this.btnHeight} + 10px); scroll-snap-type: x mandatory; justify-content: ${this.alignment}; }
          .scene-list.edit-mode { padding-bottom: 38px; }
          .scene-list::-webkit-scrollbar { display: none; }
          .scene-btn { position: relative; color: var(--scene-manager-btn-text, var(--primary-text-color)); cursor: pointer; text-align: center; font-weight: 500; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; min-width: ${this.btnWidth}; width: ${this.btnWidth}; height: ${this.btnHeight}; flex-shrink: 0; scroll-snap-align: start; transition: transform 0.1s ease-in-out, background 0.3s, border-color 0.3s, color 0.3s, box-shadow 0.3s; user-select: none; box-sizing: border-box; --btn-icon-color: var(--scene-manager-default-icon-color, var(--primary-text-color)); border-radius: var(--scene-manager-btn-border-radius, 16px); box-shadow: var(--scene-manager-btn-shadow, none); }
          #creationArea { max-height: 0; overflow: hidden; transition: max-height 0.4s ease-out, opacity 0.3s ease-out, margin 0.3s; opacity: 0; background: var(--scene-manager-creation-bg, var(--card-background-color, white)); border-radius: 16px; margin-top: 0px; box-shadow: 0 4px 20px rgba(0,0,0,0.08); border: 1px solid transparent; }
          #creationArea.open { max-height: 800px; opacity: 1; padding: 16px; margin-top: 0px; border: 1px solid var(--divider-color, #eee); overflow-y: auto; }
          .scene-btn.being-edited { border: 2px solid #4CAF50 !important; box-shadow: 0 0 15px rgba(76, 175, 80, 0.5) !important; transform: scale(0.98); }
          .color-wrapper { position: relative; width: 48px; height: 48px; flex-shrink: 0; border-radius: 50%; overflow: hidden; border: 1px solid var(--divider-color, #ccc); cursor: pointer; box-sizing: border-box; }
          input[type="color"] { -webkit-appearance: none; border: none; width: 200%; height: 200%; cursor: pointer; transform: translate(-25%, -25%); padding: 0; background: none; }
          .input-row { display: grid; grid-template-columns: 48px minmax(0, 1fr) 48px; gap: 10px; margin-bottom: 15px; align-items: center; margin-top: 15px; width: 100%; box-sizing: border-box; }
          input[type=text] { width: 100%; min-width: 0; height: 48px; padding: 0 12px; border: 1px solid var(--divider-color, #ccc); background: var(--secondary-background-color); color: var(--primary-text-color); border-radius: 8px; font-size: 16px; box-sizing: border-box; }
          button.save-btn-action { background-color: var(--primary-color, #03a9f4); color: white; border: none; border-radius: 8px; height: 48px; width: 48px; min-width: 48px; padding: 0; cursor: pointer; font-weight: bold; font-size: 24px; transition: background 0.3s; display: flex; align-items: center; justify-content: center; box-sizing: border-box; }
          button.save-btn-action.save-mode { background-color: #4CAF50; }
          .style-filled { background: var(--scene-manager-btn-bg, var(--secondary-background-color, #eee)); border: 1px solid var(--divider-color, #eee); box-shadow: 0 2px 5px rgba(0,0,0,0.05); }
          .style-outline { background: transparent; border: 2px solid var(--btn-icon-color); color: var(--primary-text-color); }
          .style-ghost { background: transparent; border: 1px solid transparent; }
          .shape-rounded { border-radius: 16px; }
          .shape-box { border-radius: 8px; }
          .shape-circle { border-radius: 50%; width: ${this.btnWidth}; height: ${this.btnWidth}; }
          .scene-btn > ha-icon { pointer-events: none; color: var(--btn-icon-color); transition: color 0.3s; }
          .scene-btn span { width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 12px; pointer-events: none; color: var(--scene-manager-btn-text, var(--primary-text-color)); }
          .scene-btn:active { transform: scale(0.92); }
          .scene-btn.activated { border-color: #4CAF50; box-shadow: 0 0 10px rgba(76, 175, 80, 0.2); }
          .scene-btn.activated ha-icon { color: #4CAF50 !important; transform: scale(1.2); }
          .scene-btn.dragging { opacity: 0.4; border: 2px dashed var(--primary-color); transform: scale(0.95); }
          .scene-btn.over { border: 2px solid var(--primary-color); transform: scale(1.05); }
          .action-badge { position: absolute; border-radius: 50%; width: 22px; height: 22px; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 4px rgba(0,0,0,0.3); opacity: 0; transform: scale(0); transition: all 0.3s; pointer-events: auto; z-index: 10; cursor: pointer; color: white; }
          .action-badge ha-icon { color: #ffffff !important; }
          .delete-badge { top: -6px; right: -6px; background-color: #f44336; }
          .edit-badge { bottom: -20px; left: 50%; transform: translateX(-50%) scale(0); background-color: var(--primary-color, #03a9f4); }
          .shape-circle .delete-badge { top: 0; right: 0; } .shape-circle .edit-badge { bottom: -14px; }
          .scene-list.edit-mode .action-badge { opacity: 1; transform: scale(1); }
          .scene-list.edit-mode .edit-badge { opacity: 1; transform: translateX(-50%) scale(1); }
          .empty { margin: auto; color: var(--secondary-text-color); padding: 10px; font-style: italic; }
          details { margin-bottom: 8px; border: 1px solid var(--divider-color, #eee); border-radius: 8px; overflow: hidden; }
          summary { background: rgba(var(--rgb-primary-color), 0.05); padding: 10px 15px; cursor: pointer; list-style: none; display: flex; align-items: center; gap: 10px; font-weight: bold; font-size: 14px; }
          summary::-webkit-details-marker { display: none; }
          .room-checkbox { width: 18px; height: 18px; cursor: pointer; accent-color: var(--primary-color); }
          .room-title { flex: 1; }
          .summary-arrow::after { content: '▼'; font-size: 10px; transition: transform 0.2s; display:block; }
          details[open] .summary-arrow::after { transform: rotate(180deg); }
          .room-content { padding: 5px 10px 10px 10px; display: flex; flex-direction: column; gap: 6px; }
          .light-row { display: flex; align-items: center; gap: 10px; padding: 4px 0; border-bottom: 1px dashed #eee; }
          .light-row:last-child { border-bottom: none; }
          .light-select { width: 18px; height: 18px; cursor: pointer; accent-color: var(--primary-color); margin-left: 10px; }
          .light-name { font-size: 13px; font-weight: 500; width: 110px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
          input[type=range] { flex: 1; -webkit-appearance: none; height: 6px; border-radius: 3px; background: #ddd; outline: none; }
          input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 16px; height: 16px; border-radius: 50%; background: var(--primary-color); cursor: pointer; }
          .light-toggle { cursor: pointer; color: var(--disabled-text-color, #bdbdbd); }
          .light-toggle.on { color: var(--primary-color, #ff9800); }
          .live-mode-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 12px; margin-bottom: 12px; border: 1px solid var(--divider-color, #eee); border-radius: 8px; background: rgba(var(--rgb-primary-color), 0.04); }
          .live-mode-label { display: flex; align-items: center; gap: 10px; min-width: 0; color: var(--primary-text-color); }
          .live-mode-label ha-icon { color: var(--secondary-text-color); }
          .live-mode-row.is-on .live-mode-label ha-icon { color: var(--primary-color); }
          .live-mode-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
          .live-mode-title { font-size: 13px; font-weight: 600; white-space: nowrap; }
          .live-mode-state { font-size: 12px; color: var(--secondary-text-color); white-space: nowrap; }
          .live-mode-switch { flex: 0 0 auto; }
          @media (max-width: 390px) {
            #creationArea.open { padding: 12px; }
            .input-row { grid-template-columns: 42px minmax(0, 1fr) 42px; gap: 8px; }
            .color-wrapper, button.save-btn-action { width: 42px; height: 42px; min-width: 42px; }
            input[type=text] { height: 42px; font-size: 15px; padding: 0 10px; }
          }
          .icon-picker { display: flex; gap: 10px; overflow-x: auto; padding: 8px 4px 15px 4px; scrollbar-width: thin; }
          .icon-option { background: var(--secondary-background-color, #eee); color: var(--primary-text-color); border-radius: 50%; width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; cursor: pointer; flex-shrink: 0; border: 2px solid transparent; transition: all 0.2s; }
          .icon-option.selected { background: var(--card-background-color, white); color: var(--primary-color); border-color: var(--primary-color); transform: scale(1.15); box-shadow: 0 3px 6px rgba(0,0,0,0.2); }
                    .scene-list-end-toggle { margin-left: auto; display: flex; align-items: center; padding-right: 8px; }
                    /* Faux scene-like toggle: visually matches .scene-btn but is not treated as a real scene button */
                    .scene-list-end-toggle .faux-scene-btn {
                        position: relative; color: var(--scene-manager-btn-text, var(--primary-text-color)); cursor: pointer; text-align: center; font-weight: 500; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; min-width: ${this.btnWidth}; width: ${this.btnWidth}; height: ${this.btnHeight}; flex-shrink: 0; scroll-snap-align: start; transition: transform 0.1s ease-in-out, background 0.3s, border-color 0.3s, color 0.3s, box-shadow 0.3s; user-select: none; box-sizing: border-box; --btn-icon-color: var(--primary-text-color); border-radius: var(--scene-manager-btn-border-radius, 16px); box-shadow: var(--scene-manager-btn-shadow, none);
                    }
        </style>
        
        <ha-card>
          <div id="headerContainer"></div>
          <div class="scene-list" id="sceneList"></div>
          <div id="creationArea">
            <div class="live-mode-row" id="liveModeRow">
              <div class="live-mode-label">
                <ha-icon icon="mdi:flash"></ha-icon>
                <div class="live-mode-text">
                  <span class="live-mode-title">Mode live</span>
                  <span class="live-mode-state" id="liveModeState">Désactivé</span>
                </div>
              </div>
              <ha-switch class="live-mode-switch" id="liveModeToggle"></ha-switch>
            </div>
            <div id="mainLightsContainer"></div>
            <div class="icon-picker" id="iconList"></div>
            <div class="input-row">
              <div class="color-wrapper" title="Couleur du bouton">
                <input type="color" id="sceneColor" value="#9E9E9E">
              </div>
              <input type="text" id="newSceneName" placeholder="Nom de la scène...">
              <button class="add-btn save-btn-action" id="saveBtn">
                 <ha-icon icon="mdi:content-save-plus"></ha-icon>
              </button>
            </div>
          </div>
        </ha-card>
      `;

        this.content = this.shadowRoot.getElementById("sceneList");
        this.headerContainer = this.shadowRoot.getElementById("headerContainer");
        this.iconList = this.shadowRoot.getElementById("iconList");
        this.inputName = this.shadowRoot.getElementById("newSceneName");
        this.inputColor = this.shadowRoot.getElementById("sceneColor");
        this.saveBtn = this.shadowRoot.getElementById("saveBtn");
        this.creationArea = this.shadowRoot.getElementById("creationArea");
        this.mainLightsContainer = this.shadowRoot.getElementById("mainLightsContainer");
        this.liveModeRow = this.shadowRoot.getElementById("liveModeRow");
        this.liveModeToggle = this.shadowRoot.getElementById("liveModeToggle");
        this.liveModeState = this.shadowRoot.getElementById("liveModeState");

        this._renderHeader();
        this._renderIconPicker();
        if (this._hass) {
            this._fetchData();
        } else {
            // Preview mode: create fake buttons
            this._createFakeButtons();
        }
        // Apply appearance variables initially
        this._applyAppearance();

        this.saveBtn.addEventListener("click", () => this._saveScene(), { passive: true });
        this.inputColor.addEventListener("input", (e) => {
            this.currentColor = e.target.value;
            if (this.editingId) this._updateContent();
        }, { passive: true });
        this.liveModeToggle.addEventListener("change", (e) => this._setLiveMode(e.target.checked));
        this._updateLiveModeControl();
    }

    _createFakeButtons() {
        const btnStyle = this.config.button_style || 'filled';
        const btnShape = this.config.button_shape || 'rounded';
        for (let i = 0; i < 3; i++) {
            const btn = document.createElement("div");
            btn.className = `scene-btn style-${btnStyle} shape-${btnShape}`;
            btn.innerHTML = `<ha-icon icon="mdi:palette"></ha-icon><span>Scène ${i + 1}</span>`;
            this.content.appendChild(btn);
        }
    }

    _updateFakeButtons() {
        const btns = this.shadowRoot.querySelectorAll('.scene-btn');
        const btnStyle = this.config.button_style || 'filled';
        const btnShape = this.config.button_shape || 'rounded';
        btns.forEach(btn => {
            btn.className = `scene-btn style-${btnStyle} shape-${btnShape}`;
        });
        // Also update the faux toggle (if present) so preview matches chosen style/shape/size
        const fauxToggles = this.shadowRoot.querySelectorAll('.faux-scene-btn');
        fauxToggles.forEach(toggle => {
            toggle.className = `toggle-btn faux-scene-btn style-${btnStyle} shape-${btnShape}`;
            // sizing should follow current button dimensions
            try { toggle.style.width = this.btnWidth; toggle.style.height = this.btnHeight; toggle.style.minWidth = this.btnWidth; } catch (e) { /* ignore */ }
        });
    }

    _applyAppearance() {
        // Apply appearance configuration to CSS variables on the ha-card
        try {
            const card = this.shadowRoot.querySelector('ha-card');
            if (!card) return;

            const cfg = this.config || {};
            // Card background
            const bgStyle = cfg.card_background_style || 'theme';
            let cardBg = 'none';
            if (bgStyle === 'theme') cardBg = 'var(--card-background-color)';
            else if (bgStyle === 'transparent') cardBg = 'transparent';
            else if (bgStyle === 'custom') cardBg = (cfg.card_background_color || 'transparent');

            // Button colors
            const btnBg = cfg.button_bg_color || 'var(--secondary-background-color, #eee)';
            const btnIcon = this._themeAwareButtonColor(cfg.button_icon_color);
            const btnText = this._themeAwareButtonColor(cfg.button_text_color);

            // Title icon color and title style
            const titleIconColor = cfg.title_icon_color || '';
            const titleStyle = cfg.title_style || 'normal';

            // Menu / creation area background
            const menuStyle = cfg.menu_background_style || 'theme';
            let menuBg = 'var(--card-background-color)';
            if (menuStyle === 'theme') menuBg = 'var(--card-background-color)';
            else if (menuStyle === 'transparent') menuBg = 'transparent';
            else if (menuStyle === 'custom') menuBg = (cfg.menu_background_color || 'transparent');

            card.style.setProperty('--scene-manager-card-bg', cardBg);
            card.style.setProperty('--scene-manager-btn-bg', btnBg);
            card.style.setProperty('--scene-manager-default-icon-color', btnIcon);
            card.style.setProperty('--scene-manager-btn-text', btnText);
            if (titleIconColor) card.style.setProperty('--scene-manager-title-icon-color', titleIconColor); else card.style.removeProperty('--scene-manager-title-icon-color');
            card.style.setProperty('--scene-manager-creation-bg', menuBg);

            // Button spacing
            const btnSpacing = cfg.button_spacing || '12';
            card.style.setProperty('--scene-manager-btn-spacing', `${btnSpacing}px`);

            // Title style mapping: weight + transform
            let weight = '500'; let transform = 'none';
            if (titleStyle === 'bold') weight = '700';
            if (titleStyle === 'uppercase') transform = 'uppercase';
            if (titleStyle === 'uppercase_bold') { weight = '700'; transform = 'uppercase'; }
            card.style.setProperty('--scene-manager-title-weight', weight);
            card.style.setProperty('--scene-manager-title-transform', transform);
        } catch (e) {
            console.warn('scene-manager: _applyAppearance error', e);
        }
    }

    _themeAwareButtonColor(value) {
        const raw = (value || '').toString().trim();
        if (!raw || raw === 'theme' || raw.toLowerCase() === '#000000') {
            return 'var(--primary-text-color)';
        }
        return raw;
    }

    _renderHeader() {
        const headerIcon = this.config.icon || "mdi:home-floor-1";
        const showIcon = this.config.show_icon !== false;
        const title = this.config.title || (this.fixedRoom ? "" : "Mes Scènes");

        const showTitle = this.config.show_title !== false;

        // Remove any existing end-toggle wrapper when re-rendering
        const existingWrapper = this.shadowRoot.querySelector('.scene-list-end-toggle');
        if (existingWrapper && existingWrapper.parentElement) existingWrapper.parentElement.removeChild(existingWrapper);

        if (!showTitle) {
            // Hide header and place the toggle button at the end of the scene list
            this.headerContainer.innerHTML = '';

            // create or reuse toggle button (faux scene-like button so it is not counted as a real scene)
            const btnStyle = (this.config && this.config.button_style) ? this.config.button_style : 'filled';
            const btnShape = (this.config && this.config.button_shape) ? this.config.button_shape : 'rounded';
            let toggle = this.shadowRoot.getElementById('toggleMenuBtn');
            if (!toggle) {
                toggle = document.createElement('div');
                toggle.className = `toggle-btn faux-scene-btn style-${btnStyle} shape-${btnShape}`;
                toggle.id = 'toggleMenuBtn';
                toggle.innerHTML = `<ha-icon icon="mdi:plus" id="toggleIcon"></ha-icon>`;
                // ensure same sizing as scene buttons
                toggle.style.width = this.btnWidth; toggle.style.height = this.btnHeight; toggle.style.minWidth = this.btnWidth;
                const wrapper = document.createElement('div');
                wrapper.className = 'scene-list-end-toggle';
                wrapper.appendChild(toggle);
                // append wrapper as last child of scene list to remain at end
                const list = this.shadowRoot.getElementById('sceneList');
                if (list) list.appendChild(wrapper);
            } else {
                // ensure it's moved to end and matching classes
                const wrapper = toggle.parentElement;
                const list = this.shadowRoot.getElementById('sceneList');
                if (wrapper && list) list.appendChild(wrapper);
                toggle.className = `toggle-btn faux-scene-btn style-${btnStyle} shape-${btnShape}`;
                toggle.style.width = this.btnWidth; toggle.style.height = this.btnHeight; toggle.style.minWidth = this.btnWidth;
            }

            this.toggleBtn = this.shadowRoot.getElementById('toggleMenuBtn');
            this.toggleIcon = this.shadowRoot.getElementById('toggleIcon');
            if (this.toggleBtn) {
                // ensure single handler (avoid duplicates) and provide keyboard accessibility
                this.toggleBtn.onclick = () => this._toggleMenu();
                this.toggleBtn.setAttribute('tabindex', '0');
                this.toggleBtn.setAttribute('role', 'button');
                this.toggleBtn.setAttribute('aria-label', 'Ajouter une scène');
                this.toggleBtn.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this._toggleMenu(); } };
            }
            // no room selector when header hidden
            this.roomSelector = null;
            return;
        }

        // Default header rendering when title is shown
        let headerContent = '';
        if (this.fixedRoom) {
            headerContent = `
            <div class="control-bar">
                ${showIcon ? `<ha-icon icon="${headerIcon}" class="header-icon"></ha-icon>` : ''}
                <div class="fixed-title"><span id="fixedRoomName">${title}</span></div>
                <div class="toggle-btn" id="toggleMenuBtn"><ha-icon icon="mdi:plus" id="toggleIcon"></ha-icon></div>
            </div>
          `;
        } else {
            headerContent = `
             <div class="control-bar">
                ${showIcon ? `<ha-icon icon="${headerIcon}" class="header-icon"></ha-icon>` : ''}
                <select class="room-selector" id="roomSelector">
                    <option value="" disabled selected>Chargement...</option>
                </select>
                <div class="toggle-btn" id="toggleMenuBtn"><ha-icon icon="mdi:plus" id="toggleIcon"></ha-icon></div>
             </div>
          `;
        }

        this.headerContainer.innerHTML = headerContent;
        this.toggleBtn = this.shadowRoot.getElementById("toggleMenuBtn");
        this.toggleIcon = this.shadowRoot.getElementById("toggleIcon");
        this.roomSelector = this.shadowRoot.getElementById("roomSelector");

        if (this.toggleBtn) {
            this.toggleBtn.onclick = () => this._toggleMenu();
            this.toggleBtn.setAttribute('tabindex', '0');
            this.toggleBtn.setAttribute('role', 'button');
            this.toggleBtn.setAttribute('aria-label', 'Ajouter une scène');
            this.toggleBtn.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this._toggleMenu(); } };
        }
        if (this.roomSelector && this.areas.length > 0) this._populateRoomSelector();
    }

    _populateRoomSelector() {
        this.roomSelector.innerHTML = "";
        this.areas.forEach(area => {
            const option = document.createElement("option");
            option.value = area.area_id; option.innerText = area.name;
            if (area.area_id === this.currentRoom.toLowerCase()) option.selected = true;
            this.roomSelector.appendChild(option);
        });
        this.roomSelector.addEventListener("change", (e) => {
            this.currentRoom = e.target.value;
            this._updateStorageEntity();
            this.shouldUpdate = true;
            this._updateContent();
            this.mainLightsContainer.innerHTML = "";
            localStorage.setItem('scene_manager_last_room', this.currentRoom);
        });
    }

    async _fetchData() {
        try {
            // Manual lights mode: zones and lights are provided by config, no auto-detection.
            if (this._useManualLights()) {
                this._applyManualZonesConfig();
                if (this.roomSelector && this.areas.length > 0) this._populateRoomSelector();
                this._checkServerUpdates();
                this.shouldUpdate = true;
                this._updateContent();
                return;
            }

            const areas = await this._hass.callWS({ type: 'config/area_registry/list' });
            this.areas = areas.sort((a, b) => a.name.localeCompare(b.name));
            const entities = await this._hass.callWS({ type: 'config/entity_registry/list' });
            this.entitiesRegistry = entities;

            if (!this.fixedRoom) {
                const lastRoom = localStorage.getItem('scene_manager_last_room');
                if (lastRoom) this.currentRoom = lastRoom;
                if (!this.currentRoom && this.areas.length > 0) this.currentRoom = this.areas[0].area_id;
                if (this.roomSelector) this._populateRoomSelector();
            } else {
                this.currentRoom = this.fixedRoom;
                const titleSpan = this.shadowRoot.getElementById("fixedRoomName");
                if (titleSpan && !this.config.title) {
                    const area = this.areas.find(a => a.area_id === this.fixedRoom);
                    titleSpan.innerText = area ? area.name : this.fixedRoom.toUpperCase();
                }
            }
            this._checkServerUpdates();
            this.shouldUpdate = true;
            this._updateContent();
        } catch (e) { console.error("Erreur", e); }
    }

    _getStorageEntityId() { return REGISTRY_ENTITY_ID; }

    _normalizeId(value) {
        return (value || '').toString().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_|_$/g, '');
    }

    _currentRoomKey() { return this._normalizeId(this.currentRoom); }
    _scenePrefixKey() { return this._normalizeId(this.config && this.config.scene_prefix); }
    _orderKey() {
        const room = this._currentRoomKey();
        const scenePrefix = this._scenePrefixKey();
        return [room, scenePrefix].filter(Boolean).join('_');
    }
    _sceneEntityPrefix() {
        const orderKey = this._orderKey();
        return orderKey ? `scene.${orderKey}_` : "scene.";
    }
    _activationTransition() {
        const transition = Number(this.config && this.config.activation_transition);
        return Number.isFinite(transition) && transition >= 0 ? transition : 2;
    }
    _liveModeEntityId() {
        const configured = this.config && this.config.live_mode_entity;
        return (configured || DEFAULT_LIVE_MODE_ENTITY_ID).toString().trim() || DEFAULT_LIVE_MODE_ENTITY_ID;
    }
    _respectLiveMode() {
        return !(this.config && this.config.respect_live_mode === false);
    }
    _liveModeEnabled() {
        if (!this._respectLiveMode()) return true;
        return this._liveModeSwitchEnabled();
    }
    _liveModeActualEnabled() {
        const entityId = this._liveModeEntityId();
        const stateObj = this._hass && this._hass.states ? this._hass.states[entityId] : null;
        if (stateObj) return stateObj.state === "on";

        const registry = this._hass && this._hass.states ? this._hass.states[this._getStorageEntityId()] : null;
        const liveMode = registry && registry.attributes ? registry.attributes.live_mode : null;
        if (typeof liveMode === "boolean") return liveMode;
        if (typeof liveMode === "string") return ["on", "true", "1", "yes"].includes(liveMode.toLowerCase());
        return null;
    }
    _liveModeSwitchEnabled() {
        if (this._liveModeOptimistic !== null) return this._liveModeOptimistic;
        const actual = this._liveModeActualEnabled();
        if (actual !== null) return actual;
        return this._storedLiveMode() === true;
    }
    _liveModeStorageKey() {
        return `scene_manager_live_mode:${this._liveModeEntityId()}`;
    }
    _storedLiveMode() {
        try {
            const value = localStorage.getItem(this._liveModeStorageKey());
            if (value === "on") return true;
            if (value === "off") return false;
        } catch (e) { /* ignore storage errors */ }
        return null;
    }
    _rememberLiveMode(enabled) {
        try {
            localStorage.setItem(this._liveModeStorageKey(), enabled ? "on" : "off");
        } catch (e) { /* ignore storage errors */ }
    }
    _updateLiveModeControl() {
        if (!this.liveModeRow || !this.liveModeToggle || !this.liveModeState) return;
        const visible = this._respectLiveMode();
        this.liveModeRow.style.display = visible ? "flex" : "none";
        if (!visible) return;

        const actual = this._liveModeActualEnabled();
        if (this._liveModeOptimistic !== null && actual === this._liveModeOptimistic) {
            this._liveModeOptimistic = null;
            this._liveModePending = false;
        }

        const isOn = this._liveModeSwitchEnabled();
        this.liveModeToggle.checked = isOn;
        this.liveModeToggle.disabled = this._liveModePending;
        this.liveModeRow.classList.toggle("is-on", isOn);
        this.liveModeState.textContent = isOn ? "Activé" : "Désactivé";
        this.liveModeToggle.title = isOn ? "Désactiver le mode live" : "Activer le mode live";
    }
    async _setLiveMode(enabled) {
        if (!this._hass) return;
        this._liveModeOptimistic = enabled;
        this._liveModePending = true;
        this._updateLiveModeControl();
        let success = false;
        try {
            await this._hass.callService("scene_manager", "set_live_mode", { enabled });
            success = true;
        } catch (err) {
            console.warn("scene-manager: set_live_mode failed, falling back to switch service", err);
            const entityId = this._liveModeEntityId();
            const service = enabled ? "turn_on" : "turn_off";
            try {
                await this._hass.callService("switch", service, { entity_id: entityId });
                success = true;
            } catch (fallbackErr) {
                console.error("scene-manager: live mode switch update failed", fallbackErr);
                this._liveModeOptimistic = null;
            }
        } finally {
            if (success) {
                this._rememberLiveMode(enabled);
            } else {
                this._liveModeOptimistic = null;
            }
            this._liveModePending = false;
            this._updateLiveModeControl();
        }
    }
    _actionSource() {
        const source = this.config && this.config.action_source;
        return (source || "card").toString().trim() || "card";
    }
    async _activateScene(entityId) {
        const transition = this._activationTransition();
        try {
            await this._hass.callService("scene_manager", "activate_scene", {
                entity_id: entityId,
                transition,
                source: this._actionSource()
            });
        } catch (err) {
            if (this.config && this.config.fallback_to_scene_service === false) throw err;
            console.warn("scene-manager: activate_scene failed, falling back to scene.turn_on", err);
            await this._hass.callService("scene", "turn_on", { entity_id: entityId, transition });
        }
    }
    _escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, char => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;',
        }[char]));
    }

    _useManualLights() {
        return !!(this.config && this.config.manual_lights);
    }

    _parseManualZones(text) {
        if (!text || typeof text !== 'string') return [];
        const lines = text.split(/\r?\n/);
        const zones = [];
        for (const rawLine of lines) {
            const line = (rawLine || '').trim();
            if (!line) continue;
            if (line.startsWith('#')) continue;
            const parts = line.split('|').map(p => (p || '').trim());
            const zoneIdRaw = (parts[0] || '').trim();
            if (!zoneIdRaw) continue;
            const zoneId = zoneIdRaw.toLowerCase();
            let zoneName = zoneIdRaw;
            let lightsPart = '';

            if (parts.length >= 3) {
                zoneName = parts[1] ? parts[1] : zoneIdRaw;
                lightsPart = parts.slice(2).join('|');
            } else if (parts.length === 2) {
                // Support minimal form: zone_id|light.a,light.b OR zone_id|Nom Zone
                if ((parts[1] || '').includes('light.') || (parts[1] || '').includes(',')) {
                    zoneName = zoneIdRaw;
                    lightsPart = parts[1] || '';
                } else {
                    zoneName = parts[1] || zoneIdRaw;
                    lightsPart = '';
                }
            }

            const lights = (lightsPart || '')
                .split(/[\s,;]+/)
                .map(s => (s || '').trim())
                .filter(Boolean)
                .filter(eid => eid.startsWith('light.'));

            zones.push({ area_id: zoneId, name: zoneName, lights });
        }
        return zones;
    }

    _parseManualRooms(rooms) {
        if (!Array.isArray(rooms)) return [];
        const parsed = [];
        for (const r of rooms) {
            const idRaw = (r && typeof r.id === 'string') ? r.id.trim() : '';
            if (!idRaw) continue;
            const area_id = idRaw.toLowerCase();
            const name = (r && typeof r.name === 'string' && r.name.trim()) ? r.name.trim() : idRaw;
            const lightsArr = (r && Array.isArray(r.lights)) ? r.lights : [];
            const lights = [...new Set(
                lightsArr
                    .map(eid => (typeof eid === 'string' ? eid.trim() : ''))
                    .filter(Boolean)
                    .filter(eid => eid.startsWith('light.'))
            )];
            parsed.push({ area_id, name, lights });
        }
        return parsed;
    }

    _applyManualZonesConfig() {
        if (!this._hass) return;
        if (!this._useManualLights()) return;

        const roomsParsed = this._parseManualRooms(this.config && this.config.manual_rooms);
        const zonesParsed = roomsParsed.length > 0 ? roomsParsed : this._parseManualZones(this.config.manual_zones || '');
        this.areas = zonesParsed;

        // Keep currentRoom consistent
        if (this.fixedRoom) {
            this.currentRoom = this.fixedRoom;
        } else {
            const lastRoom = localStorage.getItem('scene_manager_last_room');
            if (lastRoom && zonesParsed.some(z => z.area_id === lastRoom.toLowerCase())) {
                this.currentRoom = lastRoom;
            } else if (!this.currentRoom || !zonesParsed.some(z => z.area_id === (this.currentRoom || '').toLowerCase())) {
                this.currentRoom = zonesParsed.length > 0 ? zonesParsed[0].area_id : '';
            }
        }
    }

    _checkServerUpdates() {
        if (!this.currentRoom) return;
        const entityId = this._getStorageEntityId();
        const stateObj = this._hass.states[entityId];
        if (!stateObj) {
            this.cachedOrder = [];
            this.cachedMeta = {};
            return;
        }
        if (
            stateObj.last_updated !== this._lastStorageUpdate ||
            this._lastStorageRoom !== this.currentRoom
        ) {
            this._lastStorageUpdate = stateObj.last_updated;
            this._lastStorageRoom = this.currentRoom;
            if (stateObj.attributes) {
                const allOrders = stateObj.attributes.order || {};
                if (Array.isArray(allOrders)) {
                    this.cachedOrder = allOrders;
                } else {
                    this.cachedOrder = allOrders[this._orderKey()] || [];
                }
                this.cachedMeta = stateObj.attributes.meta || {};
                this._rememberSceneIconColors(this.cachedMeta);
                this.shouldUpdate = true;
            }
        }
    }

    _updateStorageEntity() { this._checkServerUpdates(); }
    _saveOrder(orderedIds) {
        this.cachedOrder = orderedIds.filter(Boolean);
        this._hass.callService("scene_manager", "reorder_scenes", {
            room: this._currentRoomKey(),
            order_key: this._orderKey(),
            order: this.cachedOrder
        }).catch(err => console.error("scene-manager: reorder_scenes failed", err));
    }
    _loadOrder() { return this.cachedOrder; }
    _saveMeta(meta) {
        this.cachedMeta = meta;
        this._rememberSceneIconColors(meta);
        this.shouldUpdate = true;
    }
    _loadMeta() { return this.cachedMeta; }
    _rememberSceneIconColors(meta) {
        if (!meta || typeof meta !== "object") return;
        Object.entries(meta).forEach(([entityId, item]) => {
            if (!item || typeof item !== "object" || !item.color) return;
            this._rememberSceneIconColor(entityId, item.color);
        });
    }
    _sceneColorStorageKey(entityId) {
        return `scene_manager_scene_color:${entityId}`;
    }
    _rememberSceneIconColor(entityId, color) {
        if (!entityId || !color || typeof color !== "string") return;
        if (!this._isHexColor(color)) return;
        this._sceneIconColors[entityId] = color;
        try {
            localStorage.setItem(this._sceneColorStorageKey(entityId), color);
        } catch (e) { /* ignore storage errors */ }
    }
    _forgetSceneIconColor(entityId) {
        if (!entityId) return;
        delete this._sceneIconColors[entityId];
        try {
            localStorage.removeItem(this._sceneColorStorageKey(entityId));
        } catch (e) { /* ignore storage errors */ }
    }
    _storedSceneIconColor(entityId) {
        if (this._sceneIconColors[entityId]) return this._sceneIconColors[entityId];
        try {
            const stored = localStorage.getItem(this._sceneColorStorageKey(entityId));
            if (stored) {
                this._sceneIconColors[entityId] = stored;
                return stored;
            }
        } catch (e) { /* ignore storage errors */ }
        return null;
    }
    _isHexColor(color) {
        return typeof color === "string" && /^#[0-9a-fA-F]{6}$/.test(color);
    }
    _sceneIconColor(entityId, localData, stateAttributes, isEditingThisScene) {
        if (isEditingThisScene) return this.inputColor.value;
        const storedColor = localData?.color || this._storedSceneIconColor(entityId) || stateAttributes.theme_color;
        if (storedColor) {
            this._rememberSceneIconColor(entityId, storedColor);
            return storedColor;
        }
        return "var(--scene-manager-default-icon-color, var(--primary-text-color))";
    }
    _scenePickerColor(entityId, localData, stateAttributes) {
        const candidates = [
            localData?.color,
            this._storedSceneIconColor(entityId),
            stateAttributes.theme_color
        ];
        return candidates.find(color => this._isHexColor(color)) || "#9E9E9E";
    }
    _visibleSceneOrder() {
        const order = Array.from(this.shadowRoot.querySelectorAll(".scene-btn"))
            .map(btn => btn.dataset.entityId)
            .filter(Boolean);
        return order.length > 0 ? order : [...this._loadOrder()];
    }
    _orderAfterSave(newEntityId, replaceEntityId) {
        const originalEntityId = this._editingOriginalEntityId || this.editingId || replaceEntityId || newEntityId;
        const snapshot = Array.isArray(this._editingOrderSnapshot) && this._editingOrderSnapshot.length > 0
            ? [...this._editingOrderSnapshot]
            : this._visibleSceneOrder();

        const originalIndex = snapshot.indexOf(originalEntityId);
        const baseOrder = snapshot
            .filter(id => id && id !== replaceEntityId && id !== newEntityId);

        if (this.editingId) {
            const insertAt = originalIndex >= 0 ? Math.min(originalIndex, baseOrder.length) : baseOrder.length;
            baseOrder.splice(insertAt, 0, newEntityId);
            return baseOrder;
        }

        baseOrder.push(newEntityId);
        return baseOrder;
    }
    _getSceneEntities(sceneId) {
        const sceneObj = this._hass.states[sceneId];
        const entities = sceneObj && sceneObj.attributes.entity_id;
        if (Array.isArray(entities)) return entities;
        if (typeof entities === "string") return [entities];
        return [];
    }
    _getSceneSnapshot(sceneId) {
        const meta = this._loadMeta();
        const item = meta && meta[sceneId];
        return item && item.entities ? item.entities : {};
    }
    _brightnessPctFromState(stateObj) {
        if (!stateObj || !stateObj.attributes) return 0;
        return stateObj.attributes.brightness ? Math.round((stateObj.attributes.brightness / 255) * 100) : (stateObj.state === "on" ? 100 : 0);
    }
    _findLightRow(eid) {
        return Array.from(this.shadowRoot.querySelectorAll(".light-row")).find(row => row.dataset.entityId === eid);
    }
    _setRowDesiredState(row, desiredState, brightnessPct = null) {
        const slider = row.querySelector(".brightness-slider");
        const toggle = row.querySelector(".light-toggle");
        const cb = row.querySelector(".light-select");
        const nextState = desiredState === "on" ? "on" : "off";
        const pct = brightnessPct === null ? Number(slider.value || 0) : Number(brightnessPct);
        const safePct = Number.isFinite(pct) ? Math.max(0, Math.min(100, pct)) : 0;

        row.dataset.desiredState = nextState;
        row.dataset.brightnessPct = String(nextState === "on" ? (safePct > 0 ? safePct : 100) : 0);
        slider.value = row.dataset.brightnessPct;
        if (nextState === "on") toggle.classList.add("on"); else toggle.classList.remove("on");
        if (cb && nextState === "on") {
            cb.checked = true;
            cb.dispatchEvent(new Event("change"));
        }
    }
    _applySnapshotToControls(sceneSnapshot) {
        if (!sceneSnapshot || typeof sceneSnapshot !== "object") return;
        Object.entries(sceneSnapshot).forEach(([eid, snapshot]) => {
            const row = this._findLightRow(eid);
            if (!row || !snapshot) return;
            const brightness = Number(snapshot.brightness);
            const pct = Number.isFinite(brightness) ? Math.round((brightness / 255) * 100) : (snapshot.state === "on" ? 100 : 0);
            const cb = row.querySelector(".light-select");
            if (cb) {
                cb.checked = true;
                cb.dispatchEvent(new Event("change"));
            }
            this._setRowDesiredState(row, snapshot.state === "on" ? "on" : "off", pct);
        });
    }
    _buildSceneSnapshot(selectedLights) {
        const snapshot = {};
        selectedLights.forEach(eid => {
            const stateObj = this._hass.states[eid];
            if (!stateObj) return;
            const row = this._findLightRow(eid);
            const attributes = { ...(stateObj.attributes || {}) };
            let desiredState = stateObj.state;
            let brightnessPct = this._brightnessPctFromState(stateObj);
            let supportsBrightness = attributes.brightness !== undefined;

            if (row) {
                desiredState = row.dataset.desiredState || desiredState;
                const slider = row.querySelector(".brightness-slider");
                supportsBrightness = slider ? !slider.disabled : supportsBrightness;
                const rowPct = Number(row.dataset.brightnessPct || slider?.value);
                if (Number.isFinite(rowPct)) brightnessPct = rowPct;
            }

            if (brightnessPct > 0) {
                desiredState = "on";
                if (supportsBrightness) attributes.brightness = Math.round((Math.max(1, Math.min(100, brightnessPct)) / 100) * 255);
                else delete attributes.brightness;
            } else if (desiredState === "off") {
                delete attributes.brightness;
            }

            snapshot[eid] = {
                state: desiredState === "off" ? "off" : "on",
                attributes
            };
        });
        return snapshot;
    }

    _buildLightControls(entitiesInScene = null, sceneSnapshot = null) {
        if (!this.isMenuOpen) return;
        let lightsByArea = {};
        let noAreaLights = [];

        if (this._useManualLights()) {
            // Use configured lights per zone
            this._applyManualZonesConfig();
            this.areas.forEach(a => { lightsByArea[a.area_id] = Array.isArray(a.lights) ? a.lights : []; });
        } else {
            const allLights = Object.keys(this._hass.states).filter((eid) => eid.startsWith("light."));
            lightsByArea = {}; this.areas.forEach(a => lightsByArea[a.area_id] = []); noAreaLights = [];

            allLights.forEach(eid => {
                let assigned = false; const entry = this.entitiesRegistry.find(e => e.entity_id === eid);
                if (entry && entry.area_id && lightsByArea[entry.area_id]) { lightsByArea[entry.area_id].push(eid); assigned = true; }
                if (!assigned) {
                    const stateObj = this._hass.states[eid];
                    const friendlyName = stateObj ? stateObj.attributes.friendly_name || "" : "";
                    for (const area of this.areas) {
                        if (eid.toLowerCase().includes(area.area_id.toLowerCase()) || friendlyName.toLowerCase().includes(area.name.toLowerCase())) { lightsByArea[area.area_id].push(eid); assigned = true; break; }
                    }
                }
                if (!assigned) noAreaLights.push(eid);
            });
        }

        this.mainLightsContainer.innerHTML = "";
        const createSection = (areaName, areaId, lights, startOpen) => {
            const details = document.createElement("details"); if (startOpen) details.open = true;
            const summary = document.createElement("summary");
            const masterCheck = document.createElement("input"); masterCheck.type = "checkbox"; masterCheck.className = "room-checkbox";
            masterCheck.addEventListener("click", (e) => { e.stopPropagation(); const checkboxes = container.querySelectorAll(".light-select"); checkboxes.forEach(cb => cb.checked = masterCheck.checked); });
            const title = document.createElement("span"); title.className = "room-title"; title.innerText = areaName;
            const arrow = document.createElement("span"); arrow.className = "summary-arrow";
            summary.appendChild(masterCheck); summary.appendChild(title); summary.appendChild(arrow); details.appendChild(summary);
            const container = document.createElement("div"); container.className = "room-content";

            if (!lights || lights.length === 0) {
                container.innerHTML = `<div style="opacity:0.5; font-size:12px; font-style:italic; text-align:center;">${this._useManualLights() ? 'Aucune lumière configurée' : 'Aucune lumière détectée'}</div>`;
            } else {
                if (!this._useManualLights()) lights.sort();
                lights.forEach(eid => {
                    const row = document.createElement("div"); row.className = "light-row"; row.dataset.entityId = eid;
                    row.innerHTML = `<input type="checkbox" class="light-select" data-entity="${eid}"><div class="light-name">...</div><input type="range" min="0" max="100" class="brightness-slider"><div class="light-toggle"><ha-icon icon="mdi:power"></ha-icon></div>`;
                    const cb = row.querySelector(".light-select");
                    cb.addEventListener("change", () => { const all = container.querySelectorAll(".light-select"); const checked = container.querySelectorAll(".light-select:checked"); masterCheck.checked = checked.length > 0; masterCheck.indeterminate = checked.length > 0 && checked.length < all.length; });
                    const toggleControl = row.querySelector(".light-toggle");
                    const slider = row.querySelector(".brightness-slider");
                    toggleControl.addEventListener("click", () => {
                        if (!this._liveModeEnabled()) {
                            const isOn = row.dataset.desiredState === "on" || toggleControl.classList.contains("on");
                            const nextPct = Number(row.dataset.brightnessPct || slider.value || 100) || 100;
                            this._setRowDesiredState(row, isOn ? "off" : "on", isOn ? 0 : nextPct);
                            return;
                        }
                        this._hass.callService("light", "toggle", { entity_id: eid });
                    });
                    slider.addEventListener("change", (e) => {
                        const val = Number(e.target.value);
                        row.dataset.desiredState = val === 0 ? "off" : "on";
                        row.dataset.brightnessPct = String(val);
                        if (!this._liveModeEnabled()) {
                            this._setRowDesiredState(row, val === 0 ? "off" : "on", val);
                            return;
                        }
                        if (val === 0) this._hass.callService("light", "turn_off", { entity_id: eid });
                        else this._hass.callService("light", "turn_on", { entity_id: eid, brightness_pct: val });
                    });
                    row.addEventListener("change", (e) => { if (e.target.classList.contains("brightness-slider")) { cb.checked = true; cb.dispatchEvent(new Event("change")); } });
                    container.appendChild(row);
                });
            }
            details.appendChild(container); this.mainLightsContainer.appendChild(details);
        };

        if (this.currentRoom) {
            const area = this.areas.find(a => a.area_id === this.currentRoom);
            const areaName = area ? area.name : this.currentRoom.toUpperCase();
            createSection(areaName, this.currentRoom, lightsByArea[this.currentRoom] || [], true);
            if (lightsByArea[this.currentRoom]) delete lightsByArea[this.currentRoom];
        }

        this.areas.forEach(area => {
            if (area.area_id !== this.currentRoom) {
                createSection(area.name, area.area_id, lightsByArea[area.area_id] || [], false);
            }
        });

        if (!this._useManualLights() && noAreaLights.length > 0) { createSection("Autres / Non Assignées", "unknown", noAreaLights, false); }

        this._updateLightStates(true);
        if (entitiesInScene) {
            this.shadowRoot.querySelectorAll(".light-select").forEach(cb => {
                if (!entitiesInScene.includes(cb.dataset.entity)) return;
                cb.checked = true;
                cb.dispatchEvent(new Event("change"));
            });
        }
        this._applySnapshotToControls(sceneSnapshot);
    }

    _updateLightStates(firstRun = false) {
        if (!this.isMenuOpen) return;
        const rows = this.shadowRoot.querySelectorAll(".light-row");
        const liveMode = this._liveModeEnabled();
        rows.forEach(row => {
            const eid = row.dataset.entityId; const stateObj = this._hass.states[eid]; if (!stateObj) return;
            const isDim = stateObj.attributes.supported_color_modes && !stateObj.attributes.supported_color_modes.includes("onoff");
            const isOn = stateObj.state === "on"; const brightness = stateObj.attributes.brightness ? Math.round((stateObj.attributes.brightness / 255) * 100) : 0;
            const name = stateObj.attributes.friendly_name || eid;
            row.querySelector(".light-name").innerText = name; row.querySelector(".light-name").title = name;
            const slider = row.querySelector(".brightness-slider");
            slider.disabled = !isDim && stateObj.attributes.brightness === undefined;
            if (slider.disabled) slider.style.opacity = 0.3; else slider.style.opacity = 1;
            const toggle = row.querySelector(".light-toggle");
            if (liveMode || !row.dataset.desiredState) {
                row.dataset.desiredState = isOn ? "on" : "off";
                row.dataset.brightnessPct = String(isOn ? brightness : 0);
            }
            slider.value = row.dataset.desiredState === "on" ? Number(row.dataset.brightnessPct || brightness || 100) : 0;
            if (row.dataset.desiredState === "on") toggle.classList.add("on"); else toggle.classList.remove("on");
            if (firstRun && !this.editingId && !this._useManualLights() && this.config.auto_select_lights !== false) { if (eid.includes(this.currentRoom) && isOn) { const cb = row.querySelector(".light-select"); cb.checked = true; cb.dispatchEvent(new Event("change")); } }
        });
        this.shadowRoot.querySelectorAll("details").forEach(detail => { const master = detail.querySelector(".room-checkbox"); const all = detail.querySelectorAll(".light-select"); const checked = detail.querySelectorAll(".light-select:checked"); if (all.length > 0) { master.checked = checked.length > 0; master.indeterminate = checked.length > 0 && checked.length < all.length; } });
    }

    _startEditing(entityId, name, icon, color) {
        this.editingId = entityId; this._editingOriginalEntityId = entityId; this._editingOrderSnapshot = this._visibleSceneOrder();
        this.inputName.value = name; this.currentIcon = icon; this.inputColor.value = this._isHexColor(color) ? color : "#9E9E9E";
        this._renderIconPicker();
        this.saveBtn.innerHTML = `<ha-icon icon="mdi:content-save-edit"></ha-icon>`;
        this.saveBtn.classList.add("save-mode");
        if (!this.isMenuOpen) this._toggleMenu(true);
        const sceneObj = this._hass.states[entityId]; const entitiesInScene = sceneObj && sceneObj.attributes.entity_id ? sceneObj.attributes.entity_id : [];
        const sceneSnapshot = this._getSceneSnapshot(entityId);
        if (this._liveModeEnabled()) this._activateScene(entityId).catch(err => console.error("scene-manager: edit preview failed", err));
        this._buildLightControls(entitiesInScene, sceneSnapshot); this._updateContent();
    }

    _stopEditing() {
        this.editingId = null;
        this._editingOriginalEntityId = null;
        this._editingOrderSnapshot = null;
        this.inputName.value = "";
        this.currentIcon = "mdi:palette";
        this.inputColor.value = "#9E9E9E";
        this.saveBtn.innerHTML = `<ha-icon icon="mdi:content-save-plus"></ha-icon>`;
        this.saveBtn.classList.remove("save-mode");
        this._updateToggleIcon();
        this._renderIconPicker(); this._buildLightControls(null); this._updateContent();
    }

    _updateToggleIcon() {
        if (this.isMenuOpen) {
            this.toggleIcon.setAttribute("icon", "mdi:close");
            this.toggleBtn.classList.add("active");
            this.toggleBtn.classList.remove("save-mode");
        } else {
            this.toggleIcon.setAttribute("icon", "mdi:plus");
            this.toggleBtn.classList.remove("active");
            this.toggleBtn.classList.remove("save-mode");
        }
    }

    _handleDragStart(e) { this.dragSrcEl = e.target.closest('.scene-btn'); this.dragSrcEl.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', this.dragSrcEl.dataset.entityId); }
    _handleDragOver(e) { if (e.preventDefault) e.preventDefault(); e.dataTransfer.dropEffect = 'move'; const target = e.target.closest('.scene-btn'); if (target && target !== this.dragSrcEl) target.classList.add('over'); return false; }
    _handleDragLeave(e) { const target = e.target.closest('.scene-btn'); if (target) target.classList.remove('over'); }
    _handleDrop(e) { if (e.stopPropagation) e.stopPropagation(); if (e.preventDefault) e.preventDefault(); const target = e.target.closest('.scene-btn'); this.shadowRoot.querySelectorAll('.scene-btn').forEach(col => { col.classList.remove('over'); col.classList.remove('dragging'); }); if (this.dragSrcEl && target && this.dragSrcEl !== target) { const srcId = this.dragSrcEl.dataset.entityId; const targetId = target.dataset.entityId; const allBtns = Array.from(this.shadowRoot.querySelectorAll(".scene-btn")); let order = allBtns.map(b => b.dataset.entityId); const srcIndex = order.indexOf(srcId); const targetIndex = order.indexOf(targetId); if (srcIndex > -1 && targetIndex > -1) { order.splice(srcIndex, 1); order.splice(targetIndex, 0, srcId); this._saveOrder(order); this._updateContent(); } } return false; }
    _handleDragEnd(e) { this.shadowRoot.querySelectorAll('.scene-btn').forEach(col => { col.classList.remove('over'); col.classList.remove('dragging'); }); }

    _toggleMenu(forceOpen = null) {
        this.isMenuOpen = forceOpen !== null ? forceOpen : !this.isMenuOpen;
        if (this.isMenuOpen) {
            this.creationArea.classList.add("open");
            this.content.classList.add("edit-mode");
            if (!this.editingId && this.mainLightsContainer.innerHTML === "") this._buildLightControls(null);
        }
        else {
            this.creationArea.classList.remove("open");
            this.content.classList.remove("edit-mode");
            this._stopEditing();
        }
        this._updateToggleIcon();
        this._updateContent();
    }

    _renderIconPicker() {
        this.iconList.innerHTML = "";
        PRESET_ICONS.forEach(icon => {
            const el = document.createElement("div"); el.className = "icon-option";
            if (icon === this.currentIcon) el.classList.add("selected");
            el.innerHTML = `<ha-icon icon="${icon}"></ha-icon>`;
            el.addEventListener("click", () => {
                this.shadowRoot.querySelectorAll(".icon-option").forEach(i => i.classList.remove("selected"));
                el.classList.add("selected");
                this.currentIcon = icon;
                if (this.editingId) this._updateContent();
            });
            this.iconList.appendChild(el);
        });
    }

    async _saveScene() {
        const name = this.inputName.value; if (!name) return alert("Nom vide !");
        const room = this._currentRoomKey(); if (!room) return alert("Aucune pièce");
        const color = this.inputColor.value; const iconToSave = this.currentIcon;

        // Improved slug generation: remove special chars, replace spaces with _, trim _
        let slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
        if (!slug) slug = "scene_" + Date.now();

        const scenePrefix = this._scenePrefixKey();
        const shortId = [room, scenePrefix, slug].filter(Boolean).join('_'); const newEntityId = `scene.${shortId}`;
        const checkboxes = this.shadowRoot.querySelectorAll(".light-select:checked");
        const selectedLights = Array.from(checkboxes).map(cb => cb.dataset.entity);
        if (selectedLights.length === 0) return alert(`Sélectionnez au moins une lumière !`);
        const snapshot = this._buildSceneSnapshot(selectedLights);

        const meta = this._loadMeta();
        const replaceEntityId = this.editingId && this.editingId !== newEntityId ? this.editingId : null;

        if (replaceEntityId && !confirm("Renommer la scène ?")) {
            return;
        }

        try {
            await this._hass.callService("scene_manager", "save_scene", {
                scene_id: shortId,
                entities: selectedLights,
                snapshot,
                icon: iconToSave,
                color: color,
                room: room,
                order_key: this._orderKey(),
                replace_entity_id: replaceEntityId
            });
        } catch (err) {
            console.error("scene-manager: save_scene failed", err);
            alert("Impossible de sauvegarder la scène. Consultez les journaux Home Assistant.");
            return;
        }

        if (replaceEntityId) {
            delete meta[replaceEntityId];
            this._forgetSceneIconColor(replaceEntityId);
        }
        const publicSnapshot = {};
        Object.entries(snapshot).forEach(([eid, item]) => {
            publicSnapshot[eid] = {
                state: item.state,
                brightness: item.attributes ? item.attributes.brightness : undefined
            };
        });
        meta[newEntityId] = { icon: iconToSave, color: color, room: room, order_key: this._orderKey(), entities: publicSnapshot };
        this._rememberSceneIconColor(newEntityId, color);
        this._saveMeta(meta);

        let order = this._orderAfterSave(newEntityId, replaceEntityId);
        this._saveOrder(order);

        this.inputName.value = ""; this._toggleMenu(false); this._updateContent();
    }

    _updateContent() {
        if (!this.currentRoom) return;
        const prefix = this._sceneEntityPrefix();
        let scenes = Object.keys(this._hass.states).filter((eid) => eid.startsWith(prefix) && this._hass.states[eid].state !== 'unavailable');
        const storedOrder = this._loadOrder(); const meta = this._loadMeta();
        if (storedOrder.length > 0) { scenes.sort((a, b) => { const indexA = storedOrder.indexOf(a); const indexB = storedOrder.indexOf(b); return (indexA === -1 ? 9999 : indexA) - (indexB === -1 ? 9999 : indexB); }); }

        this.content.innerHTML = scenes.length === 0 && this.config.show_empty !== false ? `<div class="empty">${this._escapeHtml(this.config.empty_text || 'Aucune scène')}</div>` : "";
        if (this.isMenuOpen) this.content.classList.add("edit-mode");
        const btnStyle = this.config.button_style || 'filled'; const btnShape = this.config.button_shape || 'rounded';

        scenes.forEach((entityId) => {
            let name = entityId.replace(prefix, "").replace(/_/g, " ");
            name = name.charAt(0).toUpperCase() + name.slice(1);
            const btn = document.createElement("div");
            btn.className = `scene-btn style-${btnStyle} shape-${btnShape}`;

            const localData = meta[entityId];
            const stateAttributes = this._hass.states[entityId].attributes;
            const isEditingThisScene = this.editingId === entityId;
            const themeColor = this._sceneIconColor(entityId, localData, stateAttributes, isEditingThisScene);
            const icon = isEditingThisScene ? this.currentIcon : (localData?.icon || stateAttributes.icon || "mdi:palette");

            btn.style.setProperty('--btn-icon-color', themeColor);
            btn.dataset.entityId = entityId;
            if (this.editingId === entityId) btn.classList.add("being-edited");

            btn.innerHTML = `<div class="action-badge edit-badge"><ha-icon icon="mdi:pencil" style="--mdc-icon-size: 14px;"></ha-icon></div><div class="action-badge delete-badge"><ha-icon icon="mdi:close" style="--mdc-icon-size: 14px;"></ha-icon></div><ha-icon icon="${icon}"></ha-icon><span>${name}</span>`;

            if (this.isMenuOpen) {
                btn.setAttribute('draggable', 'true'); btn.classList.add('draggable');
                btn.addEventListener('dragstart', this._handleDragStart.bind(this));
                btn.addEventListener('dragenter', this._handleDragOver.bind(this));
                btn.addEventListener('dragover', this._handleDragOver.bind(this));
                btn.addEventListener('dragleave', this._handleDragLeave.bind(this));
                btn.addEventListener('drop', this._handleDrop.bind(this));
                btn.addEventListener('dragend', this._handleDragEnd.bind(this));
            } else {
                btn.addEventListener("click", async () => {
                    try {
                        await this._activateScene(entityId);
                        btn.classList.add("activated"); setTimeout(() => btn.classList.remove("activated"), 1500);
                    } catch (err) {
                        console.error("scene-manager: activate_scene failed", err);
                    }
                });
            }
            btn.querySelector(".delete-badge").addEventListener("click", async (e) => {
                e.stopPropagation(); if (confirm(`Supprimer "${name}" ?`)) {
                    try {
                        await this._hass.callService("scene_manager", "delete_scene", { entity_id: entityId });
                    } catch (err) {
                        console.error("scene-manager: delete_scene failed", err);
                        alert("Impossible de supprimer la scène. Consultez les journaux Home Assistant.");
                        return;
                    }
                    const m = this._loadMeta(); delete m[entityId]; this._forgetSceneIconColor(entityId); this._saveMeta(m);
                    this.cachedOrder = this.cachedOrder.filter(id => id !== entityId);
                    btn.style.opacity = "0"; btn.style.width = "0px"; setTimeout(() => btn.remove(), 300);
                    if (this.editingId === entityId) this._stopEditing();
                }
            });
            btn.querySelector(".edit-badge").addEventListener("click", (e) => {
                e.stopPropagation();
                if (this.editingId === entityId) { this._stopEditing(); }
                else {
                    const sceneColor = this._scenePickerColor(entityId, localData, stateAttributes);
                    this._startEditing(entityId, name, icon, sceneColor);
                }
            });
            this.content.appendChild(btn);
        });
        // If header is hidden, ensure the toggle '+' is appended at the end of the scene list
        try {
            if (this.config && this.config.show_title === false) {
                const btnStyle = (this.config && this.config.button_style) ? this.config.button_style : 'filled';
                const btnShape = (this.config && this.config.button_shape) ? this.config.button_shape : 'rounded';
                let toggle = this.shadowRoot.getElementById('toggleMenuBtn');
                if (!toggle) {
                    const toggleEl = document.createElement('div');
                    toggleEl.className = `toggle-btn faux-scene-btn style-${btnStyle} shape-${btnShape}`;
                    toggleEl.id = 'toggleMenuBtn';
                    toggleEl.innerHTML = `<ha-icon icon="mdi:plus" id="toggleIcon"></ha-icon>`;
                    toggleEl.style.width = this.btnWidth; toggleEl.style.height = this.btnHeight; toggleEl.style.minWidth = this.btnWidth;
                    const wrapper = document.createElement('div');
                    wrapper.className = 'scene-list-end-toggle';
                    wrapper.appendChild(toggleEl);
                    this.content.appendChild(wrapper);
                    this.toggleBtn = toggleEl;
                    this.toggleIcon = this.shadowRoot.getElementById('toggleIcon');
                    // single click handler and keyboard support
                    this.toggleBtn.onclick = () => this._toggleMenu();
                    this.toggleBtn.setAttribute('tabindex', '0');
                    this.toggleBtn.setAttribute('role', 'button');
                    this.toggleBtn.setAttribute('aria-label', 'Ajouter une scène');
                    this.toggleBtn.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this._toggleMenu(); } };
                } else {
                    const wrapper = toggle.parentElement; const list = this.shadowRoot.getElementById('sceneList');
                    if (wrapper && list) list.appendChild(wrapper);
                    // ensure classes and sizing match current config
                    toggle.className = `toggle-btn faux-scene-btn style-${btnStyle} shape-${btnShape}`;
                    toggle.style.width = this.btnWidth; toggle.style.height = this.btnHeight; toggle.style.minWidth = this.btnWidth;
                    this.toggleBtn = toggle; this.toggleIcon = this.shadowRoot.getElementById('toggleIcon');
                    // ensure single handler and keyboard support
                    this.toggleBtn.onclick = () => this._toggleMenu();
                    this.toggleBtn.setAttribute('tabindex', '0');
                    this.toggleBtn.setAttribute('role', 'button');
                    this.toggleBtn.setAttribute('aria-label', 'Ajouter une scène');
                    this.toggleBtn.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this._toggleMenu(); } };
                }
            }
        } catch (e) { /* ignore preview placement errors */ }
    }
    getCardSize() { return 3; }
}

class SceneManagerEditor extends HTMLElement {
    constructor() {
        super();
        this._pickerWaitUntil = 0;
        this._pickerWaitTimer = null;
        this._pickerWaitDone = false;

        // Watch for ha-entity-picker availability to trigger re-render when it loads
        if (window.customElements && !customElements.get('ha-entity-picker')) {
            customElements.whenDefined('ha-entity-picker').then(() => {
                this.render();
            });
        }
    }

    disconnectedCallback() {
        if (this._pickerWaitTimer) {
            clearTimeout(this._pickerWaitTimer);
            this._pickerWaitTimer = null;
        }
    }

    set hass(hass) {
        this._hass = hass;
        if (!this.shadowRoot) return;
        this.shadowRoot.querySelectorAll('ha-entity-picker').forEach(p => { p.hass = hass; });
    }
    setConfig(config) { this._config = config; this.render(); }
    // propagate config-changed to HA editor (native preview will update)
    configChanged(newConfig) { this._config = newConfig; const event = new Event("config-changed", { bubbles: true, composed: true }); event.detail = { config: newConfig }; this.dispatchEvent(event); }

    _getManualRooms() {
        const rooms = (this._config && Array.isArray(this._config.manual_rooms)) ? this._config.manual_rooms : [];
        return rooms.map(r => ({
            id: (r && typeof r.id === 'string') ? r.id : '',
            name: (r && typeof r.name === 'string') ? r.name : '',
            lights: (r && Array.isArray(r.lights)) ? r.lights.filter(eid => typeof eid === 'string') : []
        }));
    }

    _setManualRooms(rooms) {
        const newConfig = { ...this._config, manual_rooms: rooms };
        this.configChanged(newConfig);
    }

    _addRoom() {
        const rooms = this._getManualRooms();
        rooms.push({ id: '', name: '', lights: [] });
        this._setManualRooms(rooms);
    }

    _removeRoom(roomIndex) {
        const rooms = this._getManualRooms();
        rooms.splice(roomIndex, 1);
        this._setManualRooms(rooms);
    }

    _updateRoom(roomIndex, patch) {
        const rooms = this._getManualRooms();
        const existing = rooms[roomIndex] || { id: '', name: '', lights: [] };
        rooms[roomIndex] = { ...existing, ...patch };
        this._setManualRooms(rooms);
    }

    _addLight(roomIndex) {
        const rooms = this._getManualRooms();
        const room = rooms[roomIndex] || { id: '', name: '', lights: [] };
        room.lights = Array.isArray(room.lights) ? [...room.lights, ''] : [''];
        rooms[roomIndex] = room;
        this._setManualRooms(rooms);
    }

    _removeLight(roomIndex, lightIndex) {
        const rooms = this._getManualRooms();
        const room = rooms[roomIndex];
        if (!room || !Array.isArray(room.lights)) return;
        room.lights = room.lights.filter((_, idx) => idx !== lightIndex);
        rooms[roomIndex] = room;
        this._setManualRooms(rooms);
    }

    _updateLight(roomIndex, lightIndex, entityId) {
        const rooms = this._getManualRooms();
        const room = rooms[roomIndex] || { id: '', name: '', lights: [] };
        const lights = Array.isArray(room.lights) ? [...room.lights] : [];
        lights[lightIndex] = entityId || '';
        room.lights = lights;
        rooms[roomIndex] = room;
        this._setManualRooms(rooms);
    }

    _moveLightUp(roomIndex, lightIndex) {
        if (lightIndex <= 0) return;
        const rooms = this._getManualRooms();
        const room = rooms[roomIndex];
        if (!room || !Array.isArray(room.lights)) return;
        const lights = [...room.lights];
        [lights[lightIndex - 1], lights[lightIndex]] = [lights[lightIndex], lights[lightIndex - 1]];
        room.lights = lights;
        rooms[roomIndex] = room;
        this._setManualRooms(rooms);
    }

    _moveLightDown(roomIndex, lightIndex) {
        const rooms = this._getManualRooms();
        const room = rooms[roomIndex];
        if (!room || !Array.isArray(room.lights)) return;
        if (lightIndex >= room.lights.length - 1) return;
        const lights = [...room.lights];
        [lights[lightIndex], lights[lightIndex + 1]] = [lights[lightIndex + 1], lights[lightIndex]];
        room.lights = lights;
        rooms[roomIndex] = room;
        this._setManualRooms(rooms);
    }

    _dragStart(e) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', JSON.stringify({
            roomIndex: e.target.dataset.roomIndex,
            lightIndex: e.target.dataset.lightIndex
        }));
        e.target.classList.add('dragging');
    }

    _dragOver(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const row = e.target.closest('.light-row');
        if (row) row.classList.add('over');
    }

    _dragLeave(e) {
        const row = e.target.closest('.light-row');
        if (row) row.classList.remove('over');
    }

    _dragEnd(e) {
        this.shadowRoot.querySelectorAll('.light-row').forEach(row => {
            row.classList.remove('dragging');
            row.classList.remove('over');
        });
    }

    _drop(e) {
        e.stopPropagation();
        e.preventDefault();
        const targetRow = e.target.closest('.light-row');
        if (!targetRow) return;

        const data = JSON.parse(e.dataTransfer.getData('text/plain'));
        const srcRoomIndex = Number(data.roomIndex);
        const srcLightIndex = Number(data.lightIndex);

        const targetRoomIndex = Number(targetRow.dataset.roomIndex);
        const targetLightIndex = Number(targetRow.dataset.lightIndex);

        if (srcRoomIndex !== targetRoomIndex) return; // Only reorder within same room
        if (srcLightIndex === targetLightIndex) return;

        this._reorderLights(srcRoomIndex, srcLightIndex, targetLightIndex);
    }

    _reorderLights(roomIndex, oldIndex, newIndex) {
        const rooms = this._getManualRooms();
        const room = rooms[roomIndex];
        if (!room || !room.lights) return;

        const lights = [...room.lights];
        const [movedLight] = lights.splice(oldIndex, 1);
        lights.splice(newIndex, 0, movedLight);

        room.lights = lights;
        rooms[roomIndex] = room;
        this._setManualRooms(rooms);
    }

    _captureFocusState() {
        if (!this.shadowRoot) return null;
        const active = this.shadowRoot.activeElement;
        if (!active) return null;

        const tag = (active.tagName || '').toLowerCase();
        const state = {
            kind: null,
            id: active.id || null,
            roomIndex: active.dataset ? active.dataset.roomIndex : null,
            lightIndex: active.dataset ? active.dataset.lightIndex : null,
            field: active.dataset ? active.dataset.field : null,
            selectionStart: null,
            selectionEnd: null
        };

        if (state.id) state.kind = 'id';
        else if (active.classList && active.classList.contains('room-input')) state.kind = 'room-input';
        else if (active.classList && active.classList.contains('light-input')) state.kind = 'light-input';
        else if (active.classList && active.classList.contains('light-select')) state.kind = 'light-select';
        else return null;

        if ((tag === 'input' || tag === 'textarea') && typeof active.selectionStart === 'number') {
            state.selectionStart = active.selectionStart;
            state.selectionEnd = active.selectionEnd;
        }
        return state;
    }

    _restoreFocusState(state) {
        if (!state || !this.shadowRoot) return;
        let el = null;
        if (state.kind === 'id' && state.id) {
            el = this.shadowRoot.getElementById(state.id);
        } else if (state.kind === 'room-input') {
            el = this.shadowRoot.querySelector(
                `input.room-input[data-room-index="${state.roomIndex}"][data-field="${state.field}"]`
            );
        } else if (state.kind === 'light-input') {
            el = this.shadowRoot.querySelector(
                `input.light-input[data-room-index="${state.roomIndex}"][data-light-index="${state.lightIndex}"]`
            );
        } else if (state.kind === 'light-select') {
            el = this.shadowRoot.querySelector(
                `select.light-select[data-room-index="${state.roomIndex}"][data-light-index="${state.lightIndex}"]`
            );
        }

        if (!el) return;
        try {
            el.focus({ preventScroll: true });
            if (typeof state.selectionStart === 'number' && typeof el.setSelectionRange === 'function') {
                el.setSelectionRange(state.selectionStart, state.selectionEnd ?? state.selectionStart);
            }
        } catch (e) {
            // ignore focus errors
        }
    }
    render() {
        if (!this.shadowRoot) this.attachShadow({ mode: 'open' });

        const focusState = this._captureFocusState();
        const pickerDefined = !!(window.customElements && window.customElements.get && window.customElements.get('ha-entity-picker'));

        // Give HA a moment to register/upgrade ha-entity-picker before falling back.
        const now = Date.now();
        const WAIT_MS = 1200;
        const POLL_MS = 150;

        if (pickerDefined) {
            this._pickerWaitUntil = 0;
            this._pickerWaitDone = false;
            if (this._pickerWaitTimer) {
                clearTimeout(this._pickerWaitTimer);
                this._pickerWaitTimer = null;
            }
        } else if (!this._pickerWaitDone) {
            if (!this._pickerWaitUntil) this._pickerWaitUntil = now + WAIT_MS;

            if (now < this._pickerWaitUntil) {
                if (!this._pickerWaitTimer) {
                    this._pickerWaitTimer = setTimeout(() => {
                        this._pickerWaitTimer = null;
                        this.render();
                    }, POLL_MS);
                }
            } else {
                this._pickerWaitUntil = 0;
                this._pickerWaitDone = true;
            }
        }

        const useEntityPicker = pickerDefined || (!this._pickerWaitDone && now < this._pickerWaitUntil);

        const hassLights = (this._hass && this._hass.states)
            ? Object.keys(this._hass.states)
                .filter(eid => typeof eid === 'string' && eid.startsWith('light.'))
                .map(eid => {
                    const st = this._hass.states[eid];
                    const name = (st && st.attributes && st.attributes.friendly_name) ? String(st.attributes.friendly_name) : eid;
                    return { eid, name };
                })
                .sort((a, b) => (a.name || a.eid).localeCompare((b.name || b.eid), undefined, { sensitivity: 'base' }))
            : null;

        const rooms = this._getManualRooms();
        const roomsHtml = rooms.map((room, ri) => {
            const lights = Array.isArray(room.lights) ? room.lights : [];
            const lightsHtml = lights.map((eid, li) => `
                            <div class="row light-row" draggable="true" data-room-index="${ri}" data-light-index="${li}">
                                <div class="drag-handle"><ha-icon icon="mdi:drag"></ha-icon></div>
                                <div class="light-picker-container" data-room-index="${ri}" data-light-index="${li}" data-value="${(eid || '').replace(/\"/g, '&quot;')}"></div>
                                <button class="icon-btn danger" type="button" data-action="remove-light" data-room-index="${ri}" data-light-index="${li}" title="Supprimer la lumière" aria-label="Supprimer la lumière"><ha-icon icon="mdi:close"></ha-icon></button>
                            </div>
                        `).join('');

            return `
                            <div class="room-block">
                                <div class="row">
                                    <div class="label">Id pièce</div>
                                    <input type="text" class="room-input" data-room-index="${ri}" data-field="id" value="${(room.id || '').replace(/\"/g, '&quot;')}" placeholder="ex: salon">
                                    <button class="icon-btn danger" type="button" data-action="remove-room" data-room-index="${ri}" title="Supprimer la pièce" aria-label="Supprimer la pièce"><ha-icon icon="mdi:delete-outline"></ha-icon></button>
                                </div>
                                <div class="row">
                                    <div class="label">Nom</div>
                                    <input type="text" class="room-input" data-room-index="${ri}" data-field="name" value="${(room.name || '').replace(/\"/g, '&quot;')}" placeholder="ex: Salon">
                                </div>
                                ${lightsHtml}
                                <div class="row">
                                    <div class="label"></div>
                                    <button class="icon-btn" type="button" data-action="add-light" data-room-index="${ri}" title="Ajouter une lumière" aria-label="Ajouter une lumière"><ha-icon icon="mdi:plus"></ha-icon></button>
                                </div>
                            </div>
                        `;
        }).join('');
        this.shadowRoot.innerHTML = `
      <style>
        .card-config { display: flex; flex-direction: column; gap: 20px; padding: 10px; }
        .option-group { border: 1px solid var(--divider-color, #ccc); border-radius: 8px; padding: 16px; }
        h3 { margin-top: 0; margin-bottom: 16px; border-bottom: 1px solid var(--divider-color, #ccc); padding-bottom: 8px; color: var(--primary-text-color); }
        .row { display: flex; align-items: center; gap: 15px; margin-bottom: 12px; flex-wrap: wrap; }
        .label { flex: 0 0 140px; font-weight: 500; color: var(--primary-text-color); }
                input, select, textarea { flex: 1; padding: 10px; border-radius: 4px; border: 1px solid var(--divider-color, #ccc); background: var(--card-background-color); color: var(--primary-text-color); box-sizing: border-box; }
                textarea { min-height: 110px; resize: vertical; font-family: var(--paper-font-body1_-_font-family); }
                .room-block { border: 1px dashed var(--divider-color, #ccc); border-radius: 8px; padding: 12px; margin-bottom: 12px; }
            .room-block .label { flex: 1 1 100%; }
            input, select, textarea, ha-entity-picker { min-width: 220px; }
            .light-row ha-entity-picker, .light-row .light-input, .light-row .light-select { flex: 1; min-height: 40px; }
            .light-row .light-picker-container { width: 280px; min-height: 40px; flex: none; }
            .icon-btn { width: 36px; height: 36px; border-radius: 6px; border: 1px solid var(--divider-color, #ccc); background: var(--card-background-color); color: var(--primary-text-color); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; flex: 0 0 36px; padding: 0; }
                .icon-btn:hover:not(:disabled) { filter: brightness(0.98); }
                .icon-btn:disabled { opacity: 0.5; cursor: not-allowed; }
                .icon-btn.danger { border-color: var(--error-color, #f44336); color: var(--error-color, #f44336); }
        .color-preview { width: 20px; height: 20px; border: 1px solid var(--divider-color, #ccc); border-radius: 4px; margin-left: 10px; display: inline-block; cursor: pointer; }
        .reset-btn { margin-left: 10px; width: 32px; height: 32px; background: #f44336; color: white; border: none; border-radius: 4px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; padding: 0; }
        .reset-btn:hover { background: #d32f2f; }
        ha-icon-picker { flex: 1; }
        .light-row { cursor: move; transition: all 0.2s ease; border: 1px solid transparent; border-radius: 4px; }
        .light-row.dragging { opacity: 0.5; background: rgba(var(--rgb-primary-color), 0.1); }
        .light-row.over { border-top: 2px solid var(--primary-color); }
        .drag-handle { cursor: grab; padding: 0 8px; display: flex; align-items: center; color: var(--secondary-text-color); }
      </style>
      <div class="card-config">
        <div class="option-group">
            <h3>Configuration</h3>
            <div class="row"><div class="label">Titre</div><input type="text" id="title" value="${this._config.title || ''}"></div>
            <div class="row"><div class="label">Icône Titre</div><ha-icon-picker id="icon" value="${this._config.icon || 'mdi:home-floor-1'}"></ha-icon-picker></div>
            <div class="row"><div class="label">Afficher Titre</div><input type="checkbox" id="show_title" ${this._config.show_title === false ? '' : 'checked'}></div>
            <div class="row"><div class="label">Style Titre</div><select id="title_style"><option value="normal" ${this._config.title_style === 'normal' ? 'selected' : ''}>Normal</option><option value="bold" ${this._config.title_style === 'bold' ? 'selected' : ''}>Gras</option><option value="uppercase" ${this._config.title_style === 'uppercase' ? 'selected' : ''}>MAJUSCULE</option><option value="uppercase_bold" ${this._config.title_style === 'uppercase_bold' ? 'selected' : ''}>MAJUSCULE + Gras</option></select></div>
            <div class="row"><div class="label">Couleur icône</div><input type="color" id="title_icon_color" value="${this._config.title_icon_color || '#000000'}"><span class="color-preview" data-for="title_icon_color" style="background-color:${this._config.title_icon_color || '#000000'};"></span><button class="reset-btn" data-for="title_icon_color" title="Réinitialiser" aria-label="Réinitialiser"><ha-icon icon="mdi:restore"></ha-icon></button></div>
            <div class="row"><div class="label">Pièce Fixe</div><input type="text" id="room" value="${this._config.room || ''}" placeholder="Optionnel (ex: salon)"></div>
            <div class="row"><div class="label">Préfixe scènes</div><input type="text" id="scene_prefix" value="${this._config.scene_prefix || ''}" placeholder="Optionnel (ex: soir)"></div>
            <div class="row"><div class="label">Afficher vide</div><input type="checkbox" id="show_empty" ${this._config.show_empty === false ? '' : 'checked'}></div>
            <div class="row"><div class="label">Message vide</div><input type="text" id="empty_text" value="${this._config.empty_text || 'Aucune scène'}"></div>
        </div>
        <div class="option-group">
            <h3>Lumières</h3>
            <div class="row"><div class="label">Mode Manuel</div><input type="checkbox" id="manual_lights" ${this._config.manual_lights ? 'checked' : ''}></div>
            <div class="row"><div class="label">Sélection auto</div><input type="checkbox" id="auto_select_lights" ${this._config.auto_select_lights === false ? '' : 'checked'}></div>
                        <div id="manual_rooms_container" style="display:${this._config.manual_lights ? 'block' : 'none'}">
                            ${roomsHtml || '<div class="row"><div class="label"></div><div style="flex:1;color:var(--secondary-text-color);">Aucune pièce configurée.</div></div>'}
                            <div class="row"><div class="label"></div><button class="icon-btn" type="button" data-action="add-room" title="Ajouter une pièce" aria-label="Ajouter une pièce"><ha-icon icon="mdi:plus"></ha-icon></button></div>
                        </div>
        </div>
        <div class="option-group">
            <h3>Mode live</h3>
            <div class="row"><div class="label">Respecter switch</div><input type="checkbox" id="respect_live_mode" ${this._config.respect_live_mode === false ? '' : 'checked'}></div>
            <div class="row"><div class="label">Switch live</div>${useEntityPicker ? `<ha-entity-picker id="live_mode_entity" value="${this._config.live_mode_entity || DEFAULT_LIVE_MODE_ENTITY_ID}"></ha-entity-picker>` : `<input type="text" id="live_mode_entity" value="${this._config.live_mode_entity || DEFAULT_LIVE_MODE_ENTITY_ID}" placeholder="${DEFAULT_LIVE_MODE_ENTITY_ID}">`}</div>
            <div class="row"><div class="label">Source action</div><input type="text" id="action_source" value="${this._config.action_source || 'card'}"></div>
            <div class="row"><div class="label">Fallback scène</div><input type="checkbox" id="fallback_to_scene_service" ${this._config.fallback_to_scene_service === false ? '' : 'checked'}></div>
        </div>
        <div class="option-group">
            <h3>Apparence</h3>
            <div class="row"><div class="label">Style Bouton</div><select id="button_style"><option value="filled" ${this._config.button_style === 'filled' ? 'selected' : ''}>Plein (Filled)</option><option value="outline" ${this._config.button_style === 'outline' ? 'selected' : ''}>Contour (Outline)</option><option value="ghost" ${this._config.button_style === 'ghost' ? 'selected' : ''}>Transparent (Ghost)</option></select></div>
            <div class="row"><div class="label">Forme Bouton</div><select id="button_shape"><option value="rounded" ${this._config.button_shape === 'rounded' ? 'selected' : ''}>Arrondi</option><option value="box" ${this._config.button_shape === 'box' ? 'selected' : ''}>Carré</option><option value="circle" ${this._config.button_shape === 'circle' ? 'selected' : ''}>Rond</option></select></div>
            <div class="row"><div class="label">Alignement</div><select id="scene_alignment"><option value="left" ${this._config.scene_alignment === 'left' ? 'selected' : ''}>Gauche</option><option value="center" ${this._config.scene_alignment === 'center' ? 'selected' : ''}>Centre</option><option value="right" ${this._config.scene_alignment === 'right' ? 'selected' : ''}>Droite</option></select></div>
            <div class="row"><div class="label">Fond Carte</div><select id="card_background_style"><option value="theme" ${this._config.card_background_style === 'theme' ? 'selected' : ''}>Theme</option><option value="transparent" ${this._config.card_background_style === 'transparent' ? 'selected' : ''}>Transparent</option><option value="custom" ${this._config.card_background_style === 'custom' ? 'selected' : ''}>Personnalisé</option></select></div>
            <div class="row" id="card_bg_color_row" style="display: ${this._config.card_background_style === 'custom' ? 'flex' : 'none'}"><div class="label">Couleur fond</div><input type="color" id="card_background_color" value="${this._config.card_background_color || '#ffffff'}"><span class="color-preview" data-for="card_background_color" style="background-color:${this._config.card_background_color || '#ffffff'};"></span><button class="reset-btn" data-for="card_background_color" title="Réinitialiser" aria-label="Réinitialiser"><ha-icon icon="mdi:restore"></ha-icon></button></div>
            <div class="row"><div class="label">Fond Menu +</div><select id="menu_background_style"><option value="theme" ${this._config.menu_background_style === 'theme' ? 'selected' : ''}>Theme</option><option value="transparent" ${this._config.menu_background_style === 'transparent' ? 'selected' : ''}>Transparent</option><option value="custom" ${this._config.menu_background_style === 'custom' ? 'selected' : ''}>Personnalisé</option></select></div>
            <div class="row" id="menu_bg_color_row" style="display: ${this._config.menu_background_style === 'custom' ? 'flex' : 'none'}"><div class="label">Couleur menu</div><input type="color" id="menu_background_color" value="${this._config.menu_background_color || '#ffffff'}"><span class="color-preview" data-for="menu_background_color" style="background-color:${this._config.menu_background_color || '#ffffff'};"></span><button class="reset-btn" data-for="menu_background_color" title="Réinitialiser" aria-label="Réinitialiser"><ha-icon icon="mdi:restore"></ha-icon></button></div>
            <div class="row"><div class="label">Couleur bouton</div><input type="color" id="button_bg_color" value="${this._config.button_bg_color || '#eeeeee'}"><span class="color-preview" data-for="button_bg_color" style="background-color:${this._config.button_bg_color || '#eeeeee'};"></span><button class="reset-btn" data-for="button_bg_color" title="Réinitialiser" aria-label="Réinitialiser"><ha-icon icon="mdi:restore"></ha-icon></button></div>
            <div class="row"><div class="label">Couleur icône</div><input type="color" id="button_icon_color" value="${this._config.button_icon_color || '#000000'}"><span class="color-preview" data-for="button_icon_color" style="background-color:${this._config.button_icon_color || '#000000'};"></span><button class="reset-btn" data-for="button_icon_color" title="Réinitialiser" aria-label="Réinitialiser"><ha-icon icon="mdi:restore"></ha-icon></button></div>
            <div class="row"><div class="label">Couleur texte</div><input type="color" id="button_text_color" value="${this._config.button_text_color || '#000000'}"><span class="color-preview" data-for="button_text_color" style="background-color:${this._config.button_text_color || '#000000'};"></span><button class="reset-btn" data-for="button_text_color" title="Réinitialiser" aria-label="Réinitialiser"><ha-icon icon="mdi:restore"></ha-icon></button></div>
        </div>
        <div class="option-group">
            <h3>Dimensions</h3>
            <div class="row"><div class="label">Largeur</div><input type="text" id="button_width" value="${this._config.button_width || '100px'}"></div>
            <div class="row"><div class="label">Hauteur</div><input type="text" id="button_height" value="${this._config.button_height || '80px'}"></div>
                        <div class="row"><div class="label">Rayon boutons</div><input type="range" id="button_border_radius" min="0" max="40" value="${this._config.button_border_radius || 16}"></div>
                        <div class="row"><div class="label">Ombre carte</div><select id="card_shadow"><option value="none" ${!this._config.card_shadow || this._config.card_shadow === 'none' ? 'selected' : ''}>Aucune</option><option value="light" ${this._config.card_shadow === 'light' ? 'selected' : ''}>Légère</option><option value="heavy" ${this._config.card_shadow === 'heavy' ? 'selected' : ''}>Forte</option></select></div>
                        <div class="row"><div class="label">Rayon carte</div><input type="range" id="card_border_radius" min="0" max="32" value="${this._config.card_border_radius || 12}"></div>
                        <div class="row"><div class="label">Espacement</div><input type="range" id="button_spacing" min="0" max="30" value="${this._config.button_spacing || 12}"></div>
                        <div class="row"><div class="label">Transition</div><input type="range" id="activation_transition" min="0" max="10" step="0.5" value="${this._config.activation_transition ?? 2}"></div>
        </div>
      </div>
    `;
        this.shadowRoot.querySelectorAll("input[type='color']").forEach(el => {
            el.addEventListener("change", (e) => {
                const newConfig = { ...this._config };
                newConfig[e.target.id] = e.target.value;
                this.configChanged(newConfig);
                // Update color preview
                const preview = e.target.nextElementSibling;
                if (preview && preview.classList.contains('color-preview')) {
                    preview.style.backgroundColor = e.target.value;
                }
            });
        });

        // special handling for icon picker
        const iconPicker = this.shadowRoot.getElementById("icon");
        if (iconPicker) {
            iconPicker.addEventListener("value-changed", (e) => {
                const newConfig = { ...this._config };
                newConfig.icon = e.detail.value;
                this.configChanged(newConfig);
            });
        }

        const liveModePicker = this.shadowRoot.getElementById("live_mode_entity");
        if (liveModePicker && liveModePicker.tagName && liveModePicker.tagName.toLowerCase() === "ha-entity-picker") {
            if (this._hass) liveModePicker.hass = this._hass;
            liveModePicker.includeDomains = ["switch"];
            liveModePicker.addEventListener("value-changed", (e) => {
                const newConfig = { ...this._config };
                newConfig.live_mode_entity = (e.detail && e.detail.value) || DEFAULT_LIVE_MODE_ENTITY_ID;
                this.configChanged(newConfig);
            });
        }

        // Toggle custom background color row
        const bgStyle = this.shadowRoot.getElementById('card_background_style');
        const bgColorRow = this.shadowRoot.getElementById('card_bg_color_row');
        if (bgStyle && bgColorRow) {
            bgStyle.addEventListener('change', (e) => {
                bgColorRow.style.display = e.target.value === 'custom' ? 'flex' : 'none';
                const newConfig = { ...this._config };
                newConfig.card_background_style = e.target.value;
                this.configChanged(newConfig);
            });
        }

        // Toggle custom menu background color row
        const menuStyleEl = this.shadowRoot.getElementById('menu_background_style');
        const menuColorRow = this.shadowRoot.getElementById('menu_bg_color_row');
        if (menuStyleEl && menuColorRow) {
            menuStyleEl.addEventListener('change', (e) => {
                menuColorRow.style.display = e.target.value === 'custom' ? 'flex' : 'none';
                const newConfig = { ...this._config };
                newConfig.menu_background_style = e.target.value;
                this.configChanged(newConfig);
            });
        }

        // Additional controls: shadows, radiuses, spacing
        const cardShadow = this.shadowRoot.getElementById('card_shadow');
        const cardRadius = this.shadowRoot.getElementById('card_border_radius');
        const btnRadius = this.shadowRoot.getElementById('button_border_radius');
        const btnSpacing = this.shadowRoot.getElementById('button_spacing');
        [cardShadow, cardRadius, btnRadius, btnSpacing].forEach(el => {
            if (!el) return;
            el.addEventListener('change', (e) => {
                const newConfig = { ...this._config };
                newConfig[e.target.id] = e.target.value;
                this.configChanged(newConfig);
            });
        });

        // Reset buttons
        this.shadowRoot.querySelectorAll('.reset-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const targetId = e.currentTarget.dataset.for;
                const input = this.shadowRoot.getElementById(targetId);
                const preview = this.shadowRoot.querySelector(`.color-preview[data-for="${targetId}"]`);
                let defaultValue = '';
                if (targetId === 'title_icon_color') defaultValue = '#000000';
                else if (targetId === 'card_background_color') defaultValue = '#ffffff';
                else if (targetId === 'menu_background_color') defaultValue = '#ffffff';
                else if (targetId === 'button_bg_color') defaultValue = '#eeeeee';
                else if (targetId === 'button_icon_color') defaultValue = '';
                else if (targetId === 'button_text_color') defaultValue = '';
                input.value = defaultValue || '#000000';
                if (preview) preview.style.backgroundColor = defaultValue || 'var(--primary-text-color)';
                const newConfig = { ...this._config };
                newConfig[targetId] = defaultValue;
                this.configChanged(newConfig);
            });
        });        // internal preview removed: rely on Home Assistant native preview
        // color inputs emit change handled above

        // Ensure selects, text inputs, ranges and checkboxes propagate changes to HA editor
        const simpleInputs = this.shadowRoot.querySelectorAll("select, textarea, input[type='text'], input[type='range'], input[type='checkbox']");
        simpleInputs.forEach(el => {
            // avoid re-wiring color inputs and elements already handled above
            if (el.type === 'color' || el.id === 'icon') return;
            if (!el.id) return;
            const eventType = el.tagName.toLowerCase() === 'select' || el.type === 'range' || el.type === 'checkbox' ? 'change' : 'input';
            el.addEventListener(eventType, (e) => {
                const newConfig = { ...this._config };
                // normalize checkbox/range/text values
                if (el.type === 'range') newConfig[el.id] = Number(e.target.value);
                else if (el.type === 'checkbox') newConfig[el.id] = e.target.checked;
                else newConfig[el.id] = e.target.value;
                this.configChanged(newConfig);

                // Special handling: re-render when manual_lights checkbox changes (to create/destroy pickers)
                if (el.id === 'manual_lights') {
                    setTimeout(() => this.render(), 100);
                }
            }, { passive: true });
        });

        // Manual rooms: inputs
        this.shadowRoot.querySelectorAll('input.room-input[data-room-index][data-field]').forEach(input => {
            // Commit only on change (blur) to avoid rerender/focus loss on each keystroke
            input.addEventListener('change', (e) => {
                const roomIndex = Number(e.target.dataset.roomIndex);
                const field = e.target.dataset.field;
                if (Number.isNaN(roomIndex) || !field) return;
                this._updateRoom(roomIndex, { [field]: e.target.value });
            }, { passive: true });
            input.addEventListener('keydown', (e) => {
                if (e.key !== 'Enter') return;
                e.preventDefault();
                e.currentTarget.blur();
            }, { passive: false });
        });

        // Manual rooms: entity pickers
        this.shadowRoot.querySelectorAll('ha-entity-picker.light-picker').forEach(picker => {
            if (this._hass) picker.hass = this._hass;
            picker.addEventListener('value-changed', (e) => {
                const roomIndex = Number(picker.dataset.roomIndex);
                const lightIndex = Number(picker.dataset.lightIndex);
                const value = (e && e.detail) ? e.detail.value : picker.value;
                if (Number.isNaN(roomIndex) || Number.isNaN(lightIndex)) return;
                this._updateLight(roomIndex, lightIndex, value);
            }, { passive: true });
        });

        // Create entity pickers dynamically in containers (defer to next microtask for DOM stability)
        Promise.resolve().then(() => {
            const containers = this.shadowRoot.querySelectorAll('.light-picker-container');

            containers.forEach((container, idx) => {
                // Clear any existing content
                container.innerHTML = '';

                const roomIndex = Number(container.dataset.roomIndex);
                const lightIndex = Number(container.dataset.lightIndex);
                const value = container.dataset.value || '';

                // Check if hass is available
                if (!this._hass) {
                    container.innerHTML = '<div style="color: red; font-size: 12px;">Hass non disponible</div>';
                    return;
                }

                // Use ha-selector (modern standard) instead of direct ha-entity-picker
                const selector = document.createElement('ha-selector');

                selector.hass = this._hass;
                selector.selector = { entity: { domain: "light" } };
                selector.value = value;
                selector.label = "";

                // Force styles
                selector.style.display = 'block';
                selector.style.width = '100%';

                selector.addEventListener('value-changed', (e) => {
                    e.stopPropagation();
                    const newValue = (e && e.detail) ? e.detail.value : selector.value;
                    if (!Number.isNaN(roomIndex) && !Number.isNaN(lightIndex)) {
                        this._updateLight(roomIndex, lightIndex, newValue);
                    }
                }, { passive: true });

                container.appendChild(selector);
            });
        });        // Manual rooms: fallback text inputs
        this.shadowRoot.querySelectorAll('input.light-input[data-room-index][data-light-index]').forEach(input => {
            input.addEventListener('change', (e) => {
                const roomIndex = Number(e.target.dataset.roomIndex);
                const lightIndex = Number(e.target.dataset.lightIndex);
                if (Number.isNaN(roomIndex) || Number.isNaN(lightIndex)) return;
                this._updateLight(roomIndex, lightIndex, e.target.value);
            }, { passive: true });
            input.addEventListener('keydown', (e) => {
                if (e.key !== 'Enter') return;
                e.preventDefault();
                e.currentTarget.blur();
            }, { passive: false });
        });

        // Manual rooms: buttons
        this.shadowRoot.querySelectorAll('button[data-action]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const action = e.currentTarget.dataset.action;
                const roomIndex = Number(e.currentTarget.dataset.roomIndex);
                const lightIndex = Number(e.currentTarget.dataset.lightIndex);
                if (action === 'add-room') return this._addRoom();
                if (action === 'remove-room') return this._removeRoom(roomIndex);
                if (action === 'add-light') return this._addLight(roomIndex);
                if (action === 'remove-light') return this._removeLight(roomIndex, lightIndex);
            }, { passive: true });
        });

        // Manual rooms: drag and drop
        this.shadowRoot.querySelectorAll('.light-row').forEach(row => {
            row.addEventListener('dragstart', this._dragStart.bind(this));
            row.addEventListener('dragover', this._dragOver.bind(this));
            row.addEventListener('dragleave', this._dragLeave.bind(this));
            row.addEventListener('drop', this._drop.bind(this));
            row.addEventListener('dragend', this._dragEnd.bind(this));
        });

        // Restore focus/cursor after re-render (prevents losing focus on each keystroke)
        this._restoreFocusState(focusState);
    }
} customElements.define("scene-manager-card", SceneManagerCard);
customElements.define("scene-manager-editor", SceneManagerEditor);
