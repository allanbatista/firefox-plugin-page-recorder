# Ícone e release XPI

## Responsabilidade

Fornecer o ícone da extensão e distribuir o pacote XPI gerado.

## Entidades

- `assets/icons/icon-page-recorder.svg`
- `build-xpi.sh`
- `.github/workflows/release.yml`

## Relações

O `browser_action.default_icon` usa o SVG. O script cria `dist/firefox-page-recorder.xpi`, que o workflow anexa à release da tag.

## Fluxo

O workflow executa o build, guarda o XPI como artifact e, em tags `v<versão>`, verifica a versão do manifesto e publica o asset.

## Fontes no código

- `manifest.json`
- `assets/icons/icon-page-recorder.svg`
- `build-xpi.sh`
- `.github/workflows/release.yml`
