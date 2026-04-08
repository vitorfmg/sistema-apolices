# Sistema de Acompanhamento de Seguros

Este projeto é a versão estável e simplificada do sistema que montamos na conversa.

## O que ele faz
- cadastro manual de apólices
- importação básica de PDFs e TXT
- tentativa de extração automática de:
  - seguradora
  - número da apólice
  - vigência inicial
  - vigência final
  - prêmio
  - empresa segurada
  - tipo de seguro
- marcação de pendências
- revisão manual
- visão mensal de vencimentos
- próximos vencimentos
- exportação em CSV

## Limitação importante
A leitura de PDF aqui é básica. Ela funciona melhor com PDFs que tenham texto interno simples. Para leitura profissional de PDFs complexos de seguradora, o ideal é uma versão com backend + OCR/Document AI.

## Como rodar
1. Instale Node.js LTS
2. No terminal:

```bash
npm install
npm run dev
```

3. Abra no navegador:

```bash
http://localhost:3000
```

## Estrutura
- `app/` páginas do Next.js
- `components/SistemaApolices.tsx` tela principal do sistema

## Dependências principais
- Next.js
- React
- Tailwind CSS
- lucide-react
