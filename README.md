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
