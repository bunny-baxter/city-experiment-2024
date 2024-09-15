import * as Util from './util.js';

const SCREEN_WIDTH = 1024;
const SCREEN_HEIGHT = 576;

const TILE_SIZE = 32;

const CAMERA_SPEED = 0.4;

const BASE_TIME_PER_TICK_SECONDS = 0.1;

const CellObjectType = Object.freeze({
  OUT_OF_BOUNDS: Symbol("out of bounds"),
  EMPTY: Symbol("empty"),
  MOUNTAIN: Symbol("mountain"),
  WATER: Symbol("water"),
  ROAD: Symbol("road"),
  ZONED_LOT: Symbol("zoned lot"),
});

const LotZoneType = Object.freeze({
  RESIDENTIAL: 0b0001,
  COMMERCIAL: 0b0010,
  OFFICE: 0b0100,
  INDUSTRIAL: 0b1000,
  COMMERCIAL_OR_OFFICE: 0b0110,
  ANY: 0b1111,
});

class LotData {
  zone_type = null;
  has_structure = false;

  constructor(zone_type) {
    this.zone_type = zone_type;
  }
}

class CellData {
  type = CellObjectType.EMPTY;
  sprite = null;
  road_bitmask = -1;
  lot_data = null;

  destroy_sprite() {
    if (this.sprite) {
      this.sprite.destroy(true);
      this.sprite = null;
    }
  }
}

const Tools = Object.freeze({
  SELECT: "select",
  DRAW_ROAD: "draw road",
  ZONE_RESIDENTIAL: "zone residential",
  DEMOLISH: "demolish",
});

function _tool_by_index(index) {
  if (index == 0) {
    return Tools.SELECT;
  }
  if (index == 1) {
    return Tools.DRAW_ROAD;
  }
  if (index == 2) {
    return Tools.ZONE_RESIDENTIAL;
  }
  if (index == 3) {
    return Tools.DEMOLISH;
  }
  console.error("Unhandled tool index: " + index);
}

const UI_DEPTH = 1;

const UI_FONT_STYLE = Object.freeze({
  fontFamily: 'Rubik',
  fontSize: '14px',
  fill: '#000000',
});

const SpriteIndexes = Object.freeze({
  HOUSE: 0,
  SMALL_SHOP: 1,
  OFFICE: 2,

  APARTMENT: 20,
  LARGE_SHOP: 21,
  PARK_PATHS: 22,
  FACTORY: 23,

  PARK_GRASS: 25,
  MOUNTAIN: 26,

  ROAD_EAST_SOUTH: 40,
  ROAD_WEST_SOUTH: 41,
  ROAD_FOURWAY: 42,
  ROAD_ISOLATE: 43,

  WATER: 45,

  ROAD_NORTH_EAST: 60,
  ROAD_NORTH_WEST: 61,
  ROAD_EAST_WEST: 62,
  ROAD_NORTH_SOUTH: 63,
  ZONE_RESIDENTIAL: 64,
  ZONE_INDUSTRIAL: 65,
  ZONE_COMMERCIAL: 66,
  ZONE_OFFICE: 67,

  ROAD_NORTH_EAST_SOUTH: 80,
  ROAD_NORTH_WEST_SOUTH: 81,
  ZONE_ANY: 84,
  ZONE_COMMERCIAL_OR_OFFICE: 86,

  ROAD_EAST_WEST_SOUTH: 100,
  ROAD_NORTH_EAST_WEST: 101,
  ROAD_EAST: 102,
  ROAD_WEST: 103,

  ROAD_SOUTH: 122,
  ROAD_NORTH: 123,
});

let level_json;
async function _fetch_level_data() {
  const response = await fetch('res/level_data.json');
  level_json = await response.json();
}
await _fetch_level_data();

// Init web fonts
WebFont.load({
  custom: {
    families: [ 'Rubik' ]
  }
});

class CityExperimentScene extends Phaser.Scene {

  world_size_tiles = { w: 64, h: 64 };
  world_size_pixels = { w: this.world_size_tiles.w * TILE_SIZE, h: this.world_size_tiles.h * TILE_SIZE };

  ticks = 0;
  tick_time_accumulator = 0;
  selected_tool = 0;
  world_cells;

  background_sprite;
  tool_text_sprites = [];
  time_text_sprite;

  constructor(phaser_config) {
    super(phaser_config);

    this.world_cells = [];
    for (let x = 0; x < this.world_size_tiles.w; x++) {
      this.world_cells.push([]);
      for (let y = 0; y < this.world_size_tiles.h; y++) {
        this.world_cells[x].push(new CellData());
      }
    }
  }

  preload() {
    this.load.image('background0', 'res/space-background.png');
    this.load.spritesheet('city_tiles', 'res/city-tiles.png', { frameWidth: 32 });
    this.load.image('tool_palette_background', 'res/tool-palette.png');
  }

  _get_cell_type(tile_x, tile_y) {
    if (!Util.hit_rect(tile_x, tile_y, 0, 0, this.world_size_tiles.w, this.world_size_tiles.h)) {
      return CellObjectType.OUT_OF_BOUNDS;
    }
    return this.world_cells[tile_x][tile_y].type;
  }

  _create_cell_sprite(tile_x, tile_y, spritesheet_index) {
    return this.add.image(tile_x * TILE_SIZE, tile_y * TILE_SIZE, 'city_tiles', spritesheet_index);
  }

  _update_road_sprite(tile_x, tile_y) {
    if (this._get_cell_type(tile_x, tile_y) !== CellObjectType.ROAD) {
      return;
    }

    let road_north = this._get_cell_type(tile_x, tile_y - 1) === CellObjectType.ROAD;
    let road_east = this._get_cell_type(tile_x + 1, tile_y) === CellObjectType.ROAD;
    let road_west = this._get_cell_type(tile_x - 1, tile_y) === CellObjectType.ROAD;
    let road_south = this._get_cell_type(tile_x, tile_y + 1) === CellObjectType.ROAD;

    let bitmask = (road_north ? 0b0001 : 0) + (road_east ? 0b0010 : 0) + (road_west ? 0b0100 : 0) + (road_south ? 0b1000 : 0);
    let cell_data = this.world_cells[tile_x][tile_y];
    if (cell_data.road_bitmask === bitmask) {
      return;
    }
    let spritesheet_index = SpriteIndexes.ROAD_ISOLATE;
    switch (bitmask) {
      case 0b0000: spritesheet_index = SpriteIndexes.ROAD_ISOLATE; break;
      case 0b0001: spritesheet_index = SpriteIndexes.ROAD_NORTH; break;
      case 0b0010: spritesheet_index = SpriteIndexes.ROAD_EAST; break;
      case 0b0100: spritesheet_index = SpriteIndexes.ROAD_WEST; break;
      case 0b1000: spritesheet_index = SpriteIndexes.ROAD_SOUTH; break;
      case 0b0011: spritesheet_index = SpriteIndexes.ROAD_NORTH_EAST; break;
      case 0b0101: spritesheet_index = SpriteIndexes.ROAD_NORTH_WEST; break;
      case 0b1001: spritesheet_index = SpriteIndexes.ROAD_NORTH_SOUTH; break;
      case 0b0110: spritesheet_index = SpriteIndexes.ROAD_EAST_WEST; break;
      case 0b1010: spritesheet_index = SpriteIndexes.ROAD_EAST_SOUTH; break;
      case 0b1100: spritesheet_index = SpriteIndexes.ROAD_WEST_SOUTH; break;
      case 0b0111: spritesheet_index = SpriteIndexes.ROAD_NORTH_EAST_WEST; break;
      case 0b1011: spritesheet_index = SpriteIndexes.ROAD_NORTH_EAST_SOUTH; break;
      case 0b1101: spritesheet_index = SpriteIndexes.ROAD_NORTH_WEST_SOUTH; break;
      case 0b1110: spritesheet_index = SpriteIndexes.ROAD_EAST_WEST_SOUTH; break;
      case 0b1111: spritesheet_index = SpriteIndexes.ROAD_FOURWAY; break;
    }

    cell_data.destroy_sprite();
    cell_data.sprite = this._create_cell_sprite(tile_x, tile_y, spritesheet_index);
    cell_data.road_bitmask = bitmask;

    if (road_north) {
      this._update_road_sprite(tile_x, tile_y - 1);
    }
    if (road_east) {
      this._update_road_sprite(tile_x + 1, tile_y);
    }
    if (road_west) {
      this._update_road_sprite(tile_x - 1, tile_y);
    }
    if (road_south) {
      this._update_road_sprite(tile_x, tile_y + 1);
    }
  }

  _set_cell(tile_x, tile_y, object_type, optional_zone_type) {
    let cell_data = this.world_cells[tile_x][tile_y];
    let zone_type_matches = cell_data.lot_data ? cell_data.lot_data.zone_type === optional_zone_type : !optional_zone_type;
    if (cell_data.type === object_type && zone_type_matches) {
      return;
    }

    let was_type = cell_data.type;
    cell_data.type = object_type;

    cell_data.destroy_sprite();
    let spritesheet_index = -1;
    if (object_type === CellObjectType.ROAD) {
      this._update_road_sprite(tile_x, tile_y);
    } else if (object_type === CellObjectType.ZONED_LOT) {
      if (optional_zone_type === LotZoneType.RESIDENTIAL) {
        spritesheet_index = SpriteIndexes.ZONE_RESIDENTIAL;
      } // TODO: Add indexes for other zone types
    } else if (object_type === CellObjectType.WATER) {
      spritesheet_index = SpriteIndexes.WATER;
    } else if (object_type === CellObjectType.MOUNTAIN) {
      spritesheet_index = SpriteIndexes.MOUNTAIN;
    }
    if (spritesheet_index >= 0) {
      cell_data.sprite = this._create_cell_sprite(tile_x, tile_y, spritesheet_index);
    }

    if (was_type === CellObjectType.ROAD) {
      cell_data.road_bitmask = -1;
      this._update_road_sprite(tile_x - 1, tile_y);
      this._update_road_sprite(tile_x + 1, tile_y);
      this._update_road_sprite(tile_x, tile_y - 1);
      this._update_road_sprite(tile_x, tile_y + 1);
    }

    if (object_type == CellObjectType.ZONED_LOT) {
      cell_data.lot_data = new LotData(optional_zone_type);
    } else {
      cell_data.lot_data = null;
    }
  }

  _can_set_cell(tile_x, tile_y, object_type) {
    let cell_type = this._get_cell_type(tile_x, tile_y);
    return cell_type != CellObjectType.OUT_OF_BOUNDS && cell_type != CellObjectType.MOUNTAIN && cell_type != CellObjectType.WATER;
  }

  _create_tool_palette() {
    let tool_palette_background = this.add.image(0, 0, 'tool_palette_background');
    tool_palette_background.setOrigin(0, 0);
    tool_palette_background.setScrollFactor(0);
    tool_palette_background.setDepth(UI_DEPTH);

    let y = 24;
    for (const [key, value] of Object.entries(Tools)) {
      let tool_text = this.add.text(24, y, value, UI_FONT_STYLE);
      tool_text.setScrollFactor(0);
      tool_text.setDepth(UI_DEPTH);
      this.tool_text_sprites.push(tool_text);
      y += 48;
    }
  }

  _select_tool(index) {
    this.tool_text_sprites[this.selected_tool].setColor('#000000');
    this.selected_tool = index;
    this.tool_text_sprites[this.selected_tool].setColor('#c62020');
  }

  _mouse_hit_tool_palette(pointer) {
    for (let i = 0; i < this.tool_text_sprites.length; i++) {
      if (Util.hit_rect(pointer.x, pointer.y, 16, 16 + i * 48, 176, 32)) {
        this._select_tool(i);
        return true;
      }
    }
    return false;
  }

  _mouse_hit_world(pointer) {
    let hit_tile_x = Math.round((pointer.x + this.cameras.main.scrollX) / TILE_SIZE);
    let hit_tile_y = Math.round((pointer.y + this.cameras.main.scrollY) / TILE_SIZE);
    let tool = _tool_by_index(this.selected_tool);

    let update_cell_type = null;
    let optional_zone_type = null;
    if (tool === Tools.DRAW_ROAD) {
      update_cell_type = CellObjectType.ROAD;
    } else if (tool === Tools.ZONE_RESIDENTIAL) {
      update_cell_type = CellObjectType.ZONED_LOT;
      optional_zone_type = LotZoneType.RESIDENTIAL;
    } else if (tool === Tools.DEMOLISH) {
      update_cell_type = CellObjectType.EMPTY;
    }
    if (update_cell_type && this._can_set_cell(hit_tile_x, hit_tile_y, update_cell_type)) {
      this._set_cell(hit_tile_x, hit_tile_y, update_cell_type, optional_zone_type);
    }

    return true;
  }

  on_mouse_down(pointer) {
    let handled = this._mouse_hit_tool_palette(pointer);
    if (!handled) {
      handled = this._mouse_hit_world(pointer);
    }
  }

  on_mouse_move(pointer) {
    if (pointer.isDown) {
      this._mouse_hit_world(pointer);
    }
  }

  create() {
    // Input
    this.a_key = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A);
    this.d_key = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D);
    this.w_key = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W);
    this.s_key = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S);
    this.right_key = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.RIGHT);
    this.left_key = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.LEFT);
    this.down_key = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.DOWN);
    this.up_key = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.UP);

    this.input.on('pointerdown', (pointer) => this.on_mouse_down(pointer));
    this.input.on('pointermove', (pointer) => this.on_mouse_move(pointer));

    // Graphics
    this.background_sprite = this.add.image(0, 0, 'background0');
    this.background_sprite.setOrigin(0, 0);
    this.background_sprite.setScrollFactor(0);

    let buildable_area_square = this.add.graphics(0, 0);
    buildable_area_square.fillStyle(0x3B291E, 1.0);
    buildable_area_square.fillRect(-TILE_SIZE / 2, -TILE_SIZE / 2, this.world_size_pixels.w, this.world_size_pixels.h);

    this._create_tool_palette();
    this._select_tool(0);

    this.time_text_sprite = this.add.text(24, 424, "time = 0", UI_FONT_STYLE);
    this.time_text_sprite.setScrollFactor(0);
    this.time_text_sprite.setDepth(UI_DEPTH);

    // Init world
    for (let y = 0; y < level_json.level.length; y++) {
      for (let x = 0; x < level_json.level[y].length; x++) {
        let c = level_json.level[y][x];
        if (c === "^") {
          this._set_cell(x, y, CellObjectType.MOUNTAIN);
        } else if (c === "w") {
          this._set_cell(x, y, CellObjectType.WATER);
        } else if (c === "=") {
          this._set_cell(x, y, CellObjectType.ROAD);
        } else if (c === "R") {
          this._set_cell(x, y, CellObjectType.ZONED_LOT, LotZoneType.RESIDENTIAL);
        }
      }
    }

    // Init camera
    this.cameras.main.scrollX = this.world_size_pixels.w / 2 - SCREEN_WIDTH / 2;
    this.cameras.main.scrollY = this.world_size_pixels.h / 2 - SCREEN_HEIGHT / 2;
  }

  _sim_cell(tile_x, tile_y) {
    let cell_data = this.world_cells[tile_x][tile_y];
    if (cell_data.lot_data && !cell_data.has_structure) {
      let has_road_access = this._get_cell_type(tile_x - 1, tile_y) === CellObjectType.ROAD ||
        this._get_cell_type(tile_x + 1, tile_y) === CellObjectType.ROAD ||
        this._get_cell_type(tile_x, tile_y + 1) === CellObjectType.ROAD ||
        this._get_cell_type(tile_x, tile_y - 1) === CellObjectType.ROAD;
      if (has_road_access && Util.rand_int(100) < 4) {
        // Build structure.
        cell_data.destroy_sprite();
        cell_data.sprite = this._create_cell_sprite(tile_x, tile_y, SpriteIndexes.HOUSE);
        cell_data.has_structure = true;
      }
    }
  }

  _tick_sim() {
    this.ticks += 1;
    this.time_text_sprite.setText("time = " + this.ticks);
    for (let y = 0; y < this.world_size_tiles.h; y++) {
      for (let x = 0; x < this.world_size_tiles.w; x++) {
        this._sim_cell(x, y);
      }
    }
  }

  update(time, delta) {
    // Update camera
    const camera_move_pixels = CAMERA_SPEED * delta;
    if (this.a_key.isDown || this.left_key.isDown) {
      this.cameras.main.scrollX -= camera_move_pixels;
    }
    if (this.d_key.isDown || this.right_key.isDown) {
      this.cameras.main.scrollX += camera_move_pixels;
    }
    if (this.w_key.isDown || this.up_key.isDown) {
      this.cameras.main.scrollY -= camera_move_pixels;
    }
    if (this.s_key.isDown || this.down_key.isDown) {
      this.cameras.main.scrollY += camera_move_pixels;
    }

    // Tick sim
    this.tick_time_accumulator += delta / 1000;
    if (this.tick_time_accumulator >= BASE_TIME_PER_TICK_SECONDS) {
      this._tick_sim();
      this.tick_time_accumulator -= BASE_TIME_PER_TICK_SECONDS;
    }
  }
}

const config = {
  type: Phaser.AUTO,
  width: SCREEN_WIDTH,
  height: SCREEN_HEIGHT,
  scene: CityExperimentScene,
  pixelArt: true,
  disableContextMenu: true,
  audio: { noAudio: true },
};

const game = new Phaser.Game(config);
