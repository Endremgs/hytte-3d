# Hytta på Tjøme – 3D mulighetsstudie

**Nettside:** https://endremgs.github.io/hytte-3d/

## Dele med andre
- Send lenken over, eller trykk **🔗 Del** i modellen: lenken husker alternativ, kameravinkel, dato/klokkeslett,
  materialer og parkering, så mottakeren ser nøyaktig det samme. På mobil åpnes delingsmenyen (SMS, Messenger …).
- Siden er ikke søkbar (`noindex` + `robots.txt`), men alle som har lenken kan åpne den.
- Offline: `https://endremgs.github.io/hytte-3d/hytte-tjome.html` kan lastes ned og åpnes uten nett.

## Utvikling
`npm install && node build.mjs` → `dist/`. Hver push til `main` bygges og publiseres automatisk (GitHub Actions → Pages).

Data i `data/` er laget av `prep/prep.py` fra Kartverket (DTM/DOM, matrikkel), OSM, Esri-flyfoto og arkitektens PDF-er.
Lokalt koordinatsystem: origo i adressepunktet (UTM32 E 580152, N 6549299), x=øst, y=nord, NN2000.

## Fotorealistiske skisser (galleri)
**Galleri:** https://endremgs.github.io/hytte-3d/galleri.html – alle alternativene rendret med Blender Cycles
(fysisk lys med solgang for Tjøme, skannede materialer, gress og trær). Bildene ligger i `public/renders/`.

Slik lages de på nytt (macOS, Blender 5.x: `brew install --cask blender`):
```sh
python3 tools/render/fetch_assets.py                                   # CC0-modeller/teksturer/HDRI fra Poly Haven -> ~/.cache/hytte3d-render
blender -b --factory-startup -P tools/render/prep_library.py           # gress og busker -> library.blend
blender -b --factory-startup -P tools/render/gen_trees.py              # eik, furu, bjørk, kratt -> trees.blend
node build.mjs && node tools/render/export.mjs [variant ...]           # bygg/terreng fra appen -> GLB + trær/sol (JSON)
tools/render/render_all.sh [variant ...]                               # Blender Cycles -> public/renders/*.jpg (FORCE=1 for å overskrive)
node tools/render/make_manifest.mjs && node build.mjs                  # galleri + miniatyrer i appen
```
Kameravinkler og klokkeslett står i `tools/render/shots.json`. Én scene tar ca. 1 min (1920×1080, 160 samples, M3 Pro).
Blender bytter materialer etter navn fra `kit.js` (kledning, tak, glass …), så nye alternativer i `site.js` kommer med automatisk.

## Nye ideer (Idé 1–5)
I tillegg til arkitektens forslag har modellen fem egne skisser (`IDEAS` i `src/site.js`). De er ikke vurdert av arkitekt:
1. **Sovehems** – 1½-etasjes nordfløy med bratt tak og takarker: mest soveplass per m² BYA.
2. **Le-vinkel** – hele hytta beholdes, ny sommerstue vestover som gir le på terrassen.
3. **Utsiktspaviljong på knausen** – glasset rom på søyler med sedumtak øverst på knausen.
4. **Forskjøvne pulttak** – ny hytte i to volumer som trappes med terrenget, glass mot kveldssola.
5. **Tun med tre hus** – hovedhuset beholdes, sovehus og badstu rundt et skjermet tun (kan bygges i etapper).

## Eiernes ønsker til tverrfløy-skissene (A20-02/A20-03)
Bryteren **Vis eiernes ønsker** (på som standard, `onsker=0` i lenken slår den av) legger på (`addWishes` m.fl. i `src/site.js`, trapper/heller/dusj i `src/landscape.js`):
- terrassen forlenget langs vestsiden helt inn til tverrfløyen og gjennom mellombygget,
- mellombygget under hovedhyttas saltak (taket forlenges til mønet møter tverrfløyens tak) – gir ca. 20 m² mer BYA,
- bred trapp ned på nedsiden fra mellombygget og gangvei med heller ned til Hellesmoveien,
- tretrapp fra sørenden av terrassen (ved berget) ned mot veien – går gjennom sonen for den hule eika,
- større avlange vinduer mot veien i hovedhytta (liggende vindusbånd eller høye stående, `vin=staende`).

**Utkast – A20-03 med utedusj** (`U1`) har i tillegg utedusj i det ytre hjørnet av tverrfløyen med platting langs gavlen.
Terrassen på berget senkes ned i berget (`sink` i `src/rockdeck.js`, femte verdi i `bt=` i lenken).
