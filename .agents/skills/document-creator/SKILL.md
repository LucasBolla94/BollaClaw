---
name: document-creator
description: Creates and sends professional documents via Telegram. Supports PDF reports, Word (DOCX) documents, and Excel (XLSX) spreadsheets with formatting, tables, headers, and styling. Use when user asks to create, generate, or make any document, report, spreadsheet, table, or file.
version: "2.0"
author: BollaClaw
runtime: python
entrypoint: scripts/main.py

dependencies:
  pip:
    - reportlab
    - python-docx
    - openpyxl

tags:
  - documents
  - pdf
  - docx
  - xlsx
  - productivity
---

# Skill: Document Creator

Cria documentos profissionais em PDF, Word (DOCX) e Excel (XLSX) e os envia automaticamente para o usuário via Telegram.

## Quando usar

- Qualquer pedido de criação de documento (PDF, Word, Excel)
- Pedidos de relatórios, planilhas, tabelas formatadas
- Quando o usuário quer receber um arquivo para download
- Pedidos de "criar documento", "gerar PDF", "fazer planilha", "montar relatório"

## Ferramentas disponíveis

### create_pdf
Cria um documento PDF profissional com:
- Título e cabeçalho com autor e data
- Seções (##), subseções (###)
- Bullet points (-)
- Tabelas (colunas separadas por |)
- Quebra de página (---)

### create_docx
Cria um documento Word (.docx) com:
- Título, headings formatados
- Estilos profissionais (Calibri)
- Tabelas com estilo "Light Grid"
- Bullet lists, bold, quebras de página

### create_xlsx
Cria uma planilha Excel (.xlsx) com:
- Headers coloridos (fundo escuro, texto branco)
- Auto-filtro nos headers
- Largura automática de colunas
- Linhas alternadas (zebra)
- Título opcional acima dos dados

## Sintaxe de conteúdo

Para PDF e DOCX, o campo `content` suporta:
```
## Seção Principal
Parágrafo de texto normal.

### Subseção
- Item de lista 1
- Item de lista 2

Nome | Idade | Cidade
João | 25 | São Paulo
Maria | 30 | Rio de Janeiro

---
(quebra de página)
```

Para XLSX, use `headers` (array) e `rows` (array de arrays).

## REGRA CRÍTICA — ENVIO VIA TELEGRAM

Após criar qualquer documento, você DEVE incluir `[FILE:caminho]` na resposta para que o arquivo seja enviado ao usuário via Telegram.

### Exemplo correto:

Usuário: "Crie um PDF com informações sobre Python"

1. Chame `create_pdf` com título, conteúdo, etc.
2. Receba o caminho do arquivo (ex: `./output/python.pdf`)
3. Responda:

```
Aqui está seu documento sobre Python! 📄

[FILE:./output/python.pdf]
```

### Exemplo ERRADO (NÃO FAÇA ISSO):
```
O documento PDF foi criado com sucesso no diretório output!
```
☝️ Isso NÃO envia o arquivo. O usuário quer RECEBER o documento, não uma descrição.

## Quando o usuário diz "envia aqui" / "manda pra mim"

Se o usuário pede para enviar um arquivo que já foi criado, use `[FILE:caminho]` com o path do arquivo existente.
