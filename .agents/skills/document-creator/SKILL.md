---
name: document-creator
description: Creates professional PDF, Word (DOCX), and Excel (XLSX) documents and sends them to the user via Telegram
version: "2.0"
author: BollaClaw
runtime: python
entrypoint: scripts/main.py

dependencies:
  pip:
    - reportlab
    - python-docx
    - openpyxl

triggers:
  - pdf
  - documento
  - document
  - word
  - docx
  - excel
  - xlsx
  - planilha
  - spreadsheet
  - relatório
  - report
  - criar documento
  - create document
  - gerar pdf
  - gerar documento
  - tabela
  - table

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

- Usuário pede para criar qualquer tipo de documento (PDF, Word, Excel)
- Usuário pede relatório, planilha, tabela, documento formatado
- Usuário pede para gerar um arquivo para download
- Qualquer menção a PDF, DOCX, XLSX, documento, relatório, planilha

## Ferramentas disponíveis

- **create_pdf**: Cria um documento PDF profissional com título, conteúdo, cabeçalho/rodapé
- **create_docx**: Cria um documento Word (.docx) com formatação profissional
- **create_xlsx**: Cria uma planilha Excel (.xlsx) com dados e formatação

## Fluxo OBRIGATÓRIO

1. Use a ferramenta apropriada (create_pdf, create_docx, ou create_xlsx)
2. A ferramenta retorna o caminho do arquivo criado
3. Na sua resposta final, SEMPRE inclua `[FILE:caminho_do_arquivo]` para que o arquivo seja enviado via Telegram
4. Adicione uma mensagem curta descrevendo o documento

## Exemplos de resposta correta

```
Aqui está seu relatório em PDF! 📄

[FILE:./output/relatorio.pdf]
```

```
Planilha criada com sucesso! 📊

[FILE:./output/dados.xlsx]
```

## REGRA CRÍTICA

NUNCA responda apenas com texto descrevendo o documento. SEMPRE use a ferramenta para criar o arquivo e SEMPRE inclua [FILE:path] na resposta. O usuário espera RECEBER o arquivo, não uma descrição dele.

Se o usuário pedir "envia aqui" ou "manda pra mim", significa que ele quer o arquivo via Telegram. Use [FILE:path] do arquivo que foi criado.

## Formato das mensagens

- Seja conciso na resposta textual
- Use emoji relevante (📄 PDF, 📝 Word, 📊 Excel)
- Inclua informações úteis: título do documento, número de páginas/linhas
- SEMPRE termine com [FILE:path]
