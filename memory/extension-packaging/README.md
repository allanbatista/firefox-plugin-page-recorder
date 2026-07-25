# Empacotamento da extensão

## Responsabilidade

Indexa o ícone e o fluxo de geração/publicação do XPI.

## Componentes

- [ASSETS_AND_RELEASE.md](ASSETS_AND_RELEASE.md): ícone, script e workflow.

## Relações

`manifest.json` referencia o ícone; `build-xpi.sh` o inclui no XPI; o workflow publica o arquivo gerado.

## Fluxo

Push ou pull request gera um artifact; uma tag `v<versão>` também cria ou atualiza a GitHub Release.

## Fontes no código

- `manifest.json`
- `build-xpi.sh`
- `.github/workflows/release.yml`
