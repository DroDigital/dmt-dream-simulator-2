"""Generates kit.json / rules.json / fixed.json for realms built on two proven WFC patterns:
   'open'   - ground + raised ground + ramps + feature tiles (like the Glyph Desert)
   'grid'   - corridors/streets between blocks (like the Evening Suburb)
Run: python3 tools/realmgen/kits.py  (writes src/realms/<realm>/)"""
import json, os
ROOT = os.path.join(os.path.dirname(__file__), '..', '..', 'src', 'realms')

def T(id, w, sockets, floor, **kw):
    t = {"id": id, "weight": w, "sockets": sockets, "floor": floor}
    t.update(kw); return t

def flat(l): return {"kind": "flat", "level": l}

def open_realm(realm, tags, ground, high, ramp, features, props, border, landmark_prop, quiet_prop, extra_tiles=()):
    tiles = [
        T("ground", 6, ["s0"]*4, flat(0), spawnable=True, mesh={"proc": ground}),
        T("high", 1.8, ["s1"]*4, flat(1), spawnable=True, mesh={"proc": ground, "params": {"level": 1}}),
        T("rise", 0.8, ["s1", "lip", "s0", "lip"], {"kind": "ramp", "from": 0, "to": 1, "low": "S"}, rotations=4, mesh={"proc": ramp}),
    ]
    for f in features:
        fid, w, rect, h, ftags, comp, proc = f
        tiles.append(T(fid, w, ["s0"]*4, flat(0), footprints=[{"rect": rect, "height": h}], tags=ftags, components=comp, scatter=False, mesh={"proc": proc}, rotations=2))
    tiles += list(extra_tiles)
    tiles += [
        T("landmark-ground", 0.01, ["s0"]*4, flat(0), scatter=False, mesh={"proc": ground}),
        T("quiet-ground", 0.01, ["s0"]*4, flat(0), scatter=False, mesh={"proc": ground}),
        T(border[0], 0, ["*"]*4, {"kind": "solid", "level": 0, "height": border[1]}, tags=border[2], components={"linkable": True}, scatter=False, mesh={"proc": border[3]}),
    ]
    kit = {"realm": realm, "grid": 50, "cell": 4, "levelHeight": 2, "linkTags": tags, "tiles": tiles, "props": props}
    rules = {"realm": realm, "compatible": [["s0", "s1"], ["lip", "s0"], ["lip", "s1"], ["lip", "lip"]],
             "weightJitter": {"high": [0.2, 3], "rise": [0.4, 2], **{f[0]: [0.3, 2.4] for f in features}},
             "density": [], "spawnCount": 4, "border": border[0], "extent": [0.62, 1.0]}
    fixed = {"realm": realm, "landmark": {"tile": "landmark-ground", "cell": [25, 25], "clear": 1, "clearTile": "ground", "prop": landmark_prop},
             "quiet": {"tile": "quiet-ground", "cell": [15, 33], "prop": quiet_prop}}
    return kit, rules, fixed

def grid_realm(realm, tags, lane, lane_s, block_tiles, yard, props, border, landmark_prop, quiet_prop):
    tiles = [
        T("lane-x", 0.6, ["lane"]*4, flat(0), spawnable=True, mesh={"proc": lane, "params": {"lines": "x"}}),
        T("lane-s", 3, ["lane", "edge", "lane", "edge"], flat(0), rotations=2, spawnable=True, mesh={"proc": lane, "params": {"lines": "s"}}),
        T("lane-t", 0.8, ["lane", "lane", "lane", "edge"], flat(0), rotations=4, spawnable=True, mesh={"proc": lane, "params": {"lines": "t"}}),
        T("lane-l", 0.8, ["lane", "lane", "edge", "edge"], flat(0), rotations=4, spawnable=True, mesh={"proc": lane, "params": {"lines": "l"}}),
        T("lane-end", 0.15, ["lane", "edge", "edge", "edge"], flat(0), rotations=4, spawnable=True, mesh={"proc": lane, "params": {"lines": "end"}}),
        T("yard", 2.5, ["yard"]*4, flat(0), spawnable=True, mesh={"proc": yard}),
    ]
    for b in block_tiles:
        bid, w, rect, h, btags, comp, proc = b
        tiles.append(T(bid, w, ["yard"]*4, flat(0), rotations=4, footprints=[{"rect": rect, "height": h}], tags=btags, components=comp, scatter=False, mesh={"proc": proc}))
    tiles += [
        T("plaza", 0.01, ["lane"]*4, flat(0), spawnable=True, mesh={"proc": lane, "params": {"lines": "none"}}),
        T("quiet-yard", 0.01, ["yard"]*4, flat(0), scatter=False, mesh={"proc": yard}),
        T(border[0], 0, ["*"]*4, {"kind": "solid", "level": 0, "height": border[1]}, tags=border[2], components={"linkable": True}, scatter=False, mesh={"proc": border[3]}),
    ]
    kit = {"realm": realm, "grid": 50, "cell": 4, "levelHeight": 2, "linkTags": tags, "tiles": tiles, "props": props}
    rules = {"realm": realm, "compatible": [["lane", "lane"], ["edge", "yard"], ["edge", "edge"]],
             "weightJitter": {**{b[0]: [0.2, 2.6] for b in block_tiles}, "lane-s": [0.6, 1.8]}, "density": [], "spawnCount": 4,
             "border": border[0], "extent": [0.62, 1.0]}
    fixed = {"realm": realm, "landmark": {"tile": "plaza", "cell": [25, 25], "clear": 1, "clearTile": "plaza", "prop": landmark_prop},
             "quiet": {"tile": "quiet-yard", "cell": [14, 34], "prop": quiet_prop}}
    return kit, rules, fixed

def P(id, tags, comp, r, h, spacing, density, on, proc, hover=None, scale=None):
    p = {"id": id, "tags": tags, "components": comp, "radius": r, "height": h, "spacing": spacing, "density": density, "on": on, "mesh": {"proc": proc}}
    if hover is not None: p["hover"] = hover
    if scale: p["scale"] = scale
    return p

L = {"linkable": True}; LA = {"linkable": True, "anomaly": True}; C = {"carryable": True}; CA = {"carryable": True, "anomaly": True}; A = {"anomaly": True}
G = ["ground", "high"]
REALMS = {}

REALMS["cloud-orchard"] = open_realm("cloud-orchard", ["light", "glass"], "cloud", "cloud", "cloudramp",
    [("orchard-tree", 1.6, [1.5, 1.5, 2.5, 2.5], 5, ["light"], LA, "planettree"), ("glass-arch", 0.4, [0.2, 1.6, 1.0, 2.4], 4, ["glass"], L, "glassarch")],
    [P("ringed-planet", ["glass", "light"], LA, 0.5, 1.6, 9, 0.06, G, "ringedplanet"), P("ladder", ["light"], L, 0.3, 2.6, 10, 0.05, G, "ladder"),
     P("cloud-sheep", ["light"], LA, 0.6, 1.0, 14, 0.03, G, "cloudsheep"), P("planet-fruit", ["light", "glass"], CA, 0, 0.2, 25, 0.006, G, "bead", hover=0.9),
     P("star-seed", ["light"], C, 0, 0.2, 25, 0.005, G, "candlestub", hover=0.9), P("sky-well", ["glass", "water"], L, 1.6, 6, 100, 0, [], "skywell"), P("hammock", ["light"], {}, 0, 1.0, 100, 0, [], "bench")],
    ("cloud-wall", 5, ["light", "glass"], "cloudwall"), "sky-well", "hammock")

REALMS["lantern-market"] = grid_realm("lantern-market", ["light", "paper"], "boardwalk", None,
    [("stall", 2.6, [0.6, 0.6, 3.4, 3.4], 3, ["paper", "light"], LA, "stall"), ("tea-house", 1.0, [0.4, 0.4, 3.6, 3.6], 6, ["paper"], L, "teahouse")],
    "canalside",
    [P("lantern-post", ["light", "paper"], LA, 0.25, 2.6, 4, 0.25, ["lane-s", "lane-t", "lane-l", "yard"], "lanternpost"),
     P("hanging-lanterns", ["light"], A, 0, 0.4, 2.5, 0.6, ["lane-s", "lane-x", "yard"], "hanginglanterns", hover=2.6),
     P("paper-crate", ["paper"], L, 0.5, 0.8, 6, 0.08, ["yard"], "crate"), P("lantern-shard", ["light"], CA, 0, 0.2, 25, 0.006, ["yard", "lane-s"], "candlestub", hover=0.9),
     P("fortune-slip", ["paper"], C, 0, 0.2, 25, 0.006, ["yard"], "scroll", hover=0.9), P("great-lantern", ["light", "paper"], LA, 1.8, 7, 100, 0, [], "greatlantern"), P("bench", ["paper"], {}, 0, 0.8, 100, 0, [], "bench")],
    ("market-wall", 4, ["paper"], "marketwall"), "great-lantern", "bench")

REALMS["tidal-stair"] = open_realm("tidal-stair", ["water"], "whitestone", "whitestone", "whitestairs",
    [("tide-pool", 1.2, [0.5, 0.5, 3.5, 3.5], 0.3, ["water"], LA, "tidepool"), ("stair-column", 0.6, [1.4, 1.4, 2.6, 2.6], 6, ["water", "light"], L, "staircolumn")],
    [P("bollard", ["water"], L, 0.3, 0.9, 6, 0.08, G, "bollard"), P("buoy-lantern", ["water", "light"], LA, 0.4, 1.4, 10, 0.05, G, "buoy"),
     P("shell", ["water"], CA, 0, 0.2, 25, 0.006, G, "bead", hover=0.9), P("moon-pebble", ["water"], C, 0, 0.2, 25, 0.005, G, "bead", hover=0.9),
     P("two-moon-gate", ["water", "light"], LA, 1.6, 7, 100, 0, [], "moongate"), P("bench", ["water"], {}, 0, 0.8, 100, 0, [], "bench")],
    ("sea", 0.3, ["water"], "sea"), "two-moon-gate", "bench")

REALMS["origami-metro"] = grid_realm("origami-metro", ["paper", "machine"], "rail", None,
    [("paper-block", 2.4, [0.4, 0.4, 3.6, 3.6], 8, ["paper"], LA, "paperblock"), ("ticket-hall", 0.8, [0.5, 0.5, 3.5, 3.5], 4, ["machine", "paper"], L, "tickethall")],
    "platform",
    [P("ticket-machine", ["machine"], LA, 0.5, 1.8, 10, 0.07, ["yard", "lane-s"], "vending"), P("paper-tree", ["paper"], L, 0.4, 3, 8, 0.07, ["yard"], "papertree"),
     P("signal", ["machine", "light"], L, 0.25, 3.5, 12, 0.05, ["lane-s", "lane-l"], "lamp"), P("paper-crane", ["paper"], CA, 0, 0.3, 25, 0.006, ["yard"], "crane", hover=0.9),
     P("ticket-stub", ["paper", "machine"], C, 0, 0.2, 25, 0.006, ["yard"], "scroll", hover=0.9), P("folding-clock", ["paper", "machine"], LA, 1.6, 9, 100, 0, [], "watertower"), P("bench", ["paper"], {}, 0, 0.8, 100, 0, [], "bench")],
    ("paper-wall", 6, ["paper"], "paperwall"), "folding-clock", "bench")

REALMS["drowned-library"] = grid_realm("drowned-library", ["water", "paper"], "aisle", None,
    [("stack", 2.8, [0.3, 1.2, 3.7, 2.8], 4.5, ["paper"], LA, "bookstack"), ("reading-pool", 0.7, [0.5, 0.5, 3.5, 3.5], 0.3, ["water"], L, "readingpool")],
    "floodfloor",
    [P("reading-desk", ["paper"], L, 0.6, 0.9, 8, 0.07, ["yard"], "lowtable"), P("drowned-lamp", ["light", "water"], LA, 0.25, 2.4, 10, 0.06, ["lane-s", "yard"], "lamp"),
     P("globe", ["water", "glass"], LA, 0.4, 1.3, 16, 0.03, ["yard"], "font"), P("wet-page", ["paper", "water"], CA, 0, 0.2, 25, 0.006, ["yard", "lane-s"], "scroll", hover=0.9),
     P("bookmark", ["paper"], C, 0, 0.2, 25, 0.005, ["yard"], "crane", hover=0.9), P("drowned-index", ["paper", "water"], LA, 1.8, 6, 100, 0, [], "greattablet"), P("bench", ["paper"], {}, 0, 0.8, 100, 0, [], "bench")],
    ("deep-shelves", 7, ["paper"], "deepshelves"), "drowned-index", "bench")

REALMS["static-field"] = open_realm("static-field", ["machine", "glyph"], "meadow", "meadow", "meadowramp",
    [("tv-mound", 1.4, [1.0, 1.0, 3.0, 3.0], 1.6, ["machine", "glyph"], LA, "tvmound"), ("antenna", 0.5, [1.6, 1.6, 2.4, 2.4], 8, ["machine"], L, "antenna")],
    [P("tv-flower", ["machine", "glyph"], LA, 0.35, 1.3, 4, 0.18, G, "tvflower"), P("phone-booth", ["machine"], {"linkable": True, "phone": True, "anomaly": True}, 0.7, 2.4, 40, 0.006, G, "phonebooth"),
     P("vhs-tape", ["machine"], CA, 0, 0.2, 25, 0.006, G, "scroll", hover=0.9), P("remote", ["machine", "glyph"], C, 0, 0.2, 25, 0.005, G, "bell", hover=0.9),
     P("great-screen", ["machine", "glyph"], LA, 2.0, 7, 100, 0, [], "greatscreen"), P("armchair", ["machine"], {}, 0, 1.0, 100, 0, [], "bench")],
    ("static-hedge", 3, ["machine"], "statichedge"), "great-screen", "armchair")

REALMS["fractal-reef"] = open_realm("fractal-reef", ["flesh", "water"], "reefsand", "reefsand", "reeframp",
    [("coral-tree", 1.8, [1.0, 1.0, 3.0, 3.0], 6, ["flesh", "water"], LA, "coraltree"), ("brain-coral", 0.8, [0.6, 0.6, 3.4, 3.4], 2, ["flesh"], L, "braincoral")],
    [P("anemone", ["flesh"], LA, 0.4, 1.0, 5, 0.12, G, "anemone"), P("glass-sponge", ["water", "glass"], L, 0.5, 1.8, 9, 0.06, G, "glasssponge"),
     P("pearl", ["water"], CA, 0, 0.2, 25, 0.006, G, "bead", hover=0.9), P("spiral-shell", ["flesh", "water"], C, 0, 0.2, 25, 0.005, G, "bead", hover=0.9),
     P("heart-coral", ["flesh", "water"], LA, 2.0, 8, 100, 0, [], "heartcoral"), P("shell-seat", ["water"], {}, 0, 0.8, 100, 0, [], "bench")],
    ("reef-wall", 6, ["flesh"], "reefwall"), "heart-coral", "shell-seat")

REALMS["the-veins"] = grid_realm("the-veins", ["flesh", "machine"], "tube", None,
    [("vein-wall", 2.6, [0.2, 0.2, 3.8, 3.8], 5, ["flesh"], LA, "veinwall"), ("organ-pipes", 1.0, [0.8, 0.8, 3.2, 3.2], 9, ["machine", "flesh"], L, "organpipes")],
    "membrane",
    [P("valve", ["machine"], L, 0.4, 1.2, 8, 0.08, ["yard", "lane-s"], "valve"), P("pulse-node", ["flesh", "light"], LA, 0.5, 1.5, 9, 0.08, ["yard", "lane-s", "lane-t"], "pulsenode"),
     P("warm-stone", ["flesh"], CA, 0, 0.2, 25, 0.006, ["yard"], "bead", hover=0.9), P("brass-key", ["machine"], C, 0, 0.2, 25, 0.005, ["yard"], "bell", hover=0.9),
     P("great-heart", ["flesh", "machine"], LA, 2.0, 6, 100, 0, [], "heartcoral"), P("bench", ["flesh"], {}, 0, 0.8, 100, 0, [], "bench")],
    ("vein-border", 6, ["flesh"], "veinborder"), "great-heart", "bench")

REALMS["night-school"] = grid_realm("night-school", ["paper", "machine", "glass", "light", "water", "flesh", "glyph"], "corridor", None,
    [("classroom", 2.8, [0.3, 0.3, 3.7, 3.7], 3.4, ["paper", "glass"], LA, "classroom"), ("lab-room", 0.8, [0.3, 0.3, 3.7, 3.7], 3.4, ["machine", "water"], L, "labroom"),
     ("music-room", 0.5, [0.3, 0.3, 3.7, 3.7], 3.4, ["light", "glyph"], L, "musicroom"), ("art-room", 0.5, [0.3, 0.3, 3.7, 3.7], 3.4, ["flesh", "paper"], L, "artroom")],
    "schoolyard",
    [P("lockers", ["machine"], LA, 0.5, 2.0, 8, 0.07, ["lane-s", "lane-t"], "lockers"), P("water-fountain", ["water"], L, 0.3, 1.0, 14, 0.04, ["lane-s"], "font"),
     P("notice-board", ["paper", "glyph"], LA, 0.3, 2.0, 12, 0.04, ["lane-s", "yard"], "windsign"), P("chalk", ["glyph"], CA, 0, 0.2, 25, 0.006, ["lane-s", "yard"], "candlestub", hover=0.9),
     P("hall-pass", ["paper"], C, 0, 0.2, 25, 0.006, ["yard", "lane-s"], "scroll", hover=0.9), P("school-clock", ["machine", "glass"], LA, 1.4, 8, 100, 0, [], "watertower"), P("bench", ["paper"], {}, 0, 0.8, 100, 0, [], "bench")],
    ("school-wall", 6, ["paper"], "schoolwall"), "school-clock", "bench")

for realm, (kit, rules, fixed) in REALMS.items():
    d = os.path.join(ROOT, realm); os.makedirs(d, exist_ok=True)
    for name, obj in (("kit", kit), ("rules", rules), ("fixed", fixed)):
        json.dump(obj, open(os.path.join(d, name + ".json"), "w"), indent=1)
print("wrote", ", ".join(REALMS))
