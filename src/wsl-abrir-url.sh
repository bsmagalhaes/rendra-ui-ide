#!/bin/sh
# Rendra IDE: abre uma URL no navegador padrão do Windows, a partir de um terminal WSL.
# O Claude Code chama $BROWSER com a URL como único argumento (sem shell). O rundll32 recebe a URL
# como argumento comum, então & % = , chegam inteiros (o explorer.exe quebra nos = e abre uma pasta).
command -v rundll32.exe >/dev/null 2>&1 || PATH="$PATH:/mnt/c/Windows/System32"
exec rundll32.exe url.dll,FileProtocolHandler "$1"
