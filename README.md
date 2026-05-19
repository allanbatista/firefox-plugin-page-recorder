# Firefox Page Recorder

Extensão simples para gravar a área visível da aba ativa e baixar o vídeo no fim, usando MP4 quando disponível e WebM/VP8 como fallback.

## Como usar

1. Abra `about:debugging`.
2. Clique em "This Firefox".
3. Use "Load Temporary Add-on" e selecione `manifest.json`.
4. Abra a página que você quer gravar.
5. Clique no botão da extensão e inicie a gravação.
6. Clique em parar para baixar o arquivo.

## Saída

- Nome do arquivo: `dominio-timestamp.mp4` ou `dominio-timestamp.webm`
- Formato: MP4 quando suportado; caso contrário WebM/VP8
- Codec: H.264 ou VP8, conforme o suporte do Firefox/OS
- Taxa fixa: 8 fps
- Taxa de bits: ajustada pela resolução da captura

## Observação

Se o seu Firefox não tiver suporte de gravação MP4/H.264 neste sistema, a extensão tenta WebM/VP8. Se nenhum formato estiver disponível, mostra erro ao iniciar.
