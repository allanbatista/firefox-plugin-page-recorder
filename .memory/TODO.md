# [medium] Validar no Firefox real

Ainda falta executar a extensão em uma sessão real do Firefox para confirmar o fluxo completo de gravação, parada e download do MP4/H.264. Próximo passo: abrir a extensão via `about:debugging` e registrar o resultado fim a fim.

# [medium] Validar fallback MP4/WebM

A alteração de fallback para WebM/VP8 ainda precisa de teste em Firefox real para confirmar que a escolha de formato, o nome do arquivo e o download continuam corretos quando MP4 não estiver disponível.

# [medium] Validar qualidade da captura

A captura agora usa PNG e bitrate proporcional à resolução, mas ainda falta testar em Firefox real para confirmar se a saída ficou nítida e se o custo de arquivo/CPU está aceitável.
