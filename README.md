# Firefox Page Recorder

Extensão simples para gravar a área visível da aba ativa e baixar o vídeo no fim.

## Como usar

1. Abra `about:debugging`.
2. Clique em "This Firefox".
3. Use "Load Temporary Add-on" e selecione `manifest.json`.
4. Abra a página que você quer gravar.
5. Clique no botão da extensão e inicie a gravação.
6. Clique em parar para baixar o arquivo.

## Saída

- Nome do arquivo: `dominio-timestamp.mp4`
- Formato: MP4
- Codec: H.264 quando o Firefox/OS suportar gravação MP4
- Taxa fixa: 8 fps

## Observação

Se o seu Firefox não tiver suporte de gravação MP4/H.264 neste sistema, a extensão mostra erro ao iniciar.

