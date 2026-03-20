---
name: skill-creator
description: Cria, valida e gerencia skills para o BollaClaw — usa as ferramentas built-in create_skill, list_skills, validate_skill e delete_skill
version: "2.0"
author: BollaClaw
runtime: bash
triggers:
  - criar skill
  - nova skill
  - create skill
  - new skill
  - implementar skill
  - automatizar
  - integração
  - conectar api
  - criar automação
  - nova ferramenta
  - adicionar funcionalidade
  - instalar skill
tags:
  - meta
  - development
  - automation
---

# Skill: Criador de Skills v2

Você é um engenheiro de software sênior. Quando o usuário pedir para criar uma skill, você DEVE usar as ferramentas built-in disponíveis.

## 🔧 Ferramentas Disponíveis

Você tem estas ferramentas built-in para gerenciar skills:

1. **list_skills** — Lista todas as skills instaladas (use ANTES de criar, para evitar duplicatas)
2. **create_skill** — Cria uma skill completa (SKILL.md + scripts + tools + deps)
3. **validate_skill** — Valida uma skill existente (erros e warnings)
4. **delete_skill** — Remove uma skill instalada

## 📋 Processo de Criação (OBRIGATÓRIO)

### Passo 1: Verificar skills existentes
```
Use: list_skills (verbose: true)
```
Verifique se já existe uma skill similar. Se existir, pergunte ao usuário se quer atualizar ou criar uma nova.

### Passo 2: Planejar a skill
Antes de chamar create_skill, pense:
- **Nome**: kebab-case, descritivo, único (ex: "weather-api", "crypto-price", "pdf-reader")
- **Runtime**: Python é o preferido (mais confiável no servidor)
- **Scripts**: O que o script principal precisa fazer?
- **Tools**: Que ferramentas o LLM poderá chamar?
- **Deps**: Que bibliotecas são necessárias?
- **Triggers**: Palavras que ativam sem LLM routing

### Passo 3: Escrever o script principal
O script DEVE seguir este contrato de I/O:

```python
#!/usr/bin/env python3
"""
Skill: nome-da-skill
Description: O que faz
"""
import sys
import json

def main():
    # Lê argumentos JSON do stdin
    raw = sys.stdin.read().strip()
    args = json.loads(raw) if raw else {}

    # Identifica qual tool chamou este script
    tool = args.get('__tool__', '')

    # Roteamento por tool
    if tool == 'minha_ferramenta':
        result = minha_ferramenta(args)
    elif tool == 'outra_ferramenta':
        result = outra_ferramenta(args)
    else:
        result = {'error': f'Tool desconhecida: {tool}'}

    # Retorna JSON no stdout
    print(json.dumps(result, ensure_ascii=False))

def minha_ferramenta(args):
    try:
        # Valida inputs
        param = args.get('param', '')
        if not param:
            return {'error': 'Parâmetro "param" é obrigatório'}

        # Sua lógica aqui
        resultado = f"Processado: {param}"

        return {
            'status': 'ok',
            'data': resultado
        }
    except Exception as e:
        return {'error': f'Falha: {str(e)}'}

if __name__ == '__main__':
    main()
```

### Passo 4: Definir as Tools (ferramentas)
Cada tool é um JSON Schema que diz ao LLM como usá-la:

```json
{
  "name": "minha_ferramenta",
  "description": "Faz X com Y — use quando o usuário pedir Z",
  "parameters": {
    "type": "object",
    "properties": {
      "param": {
        "type": "string",
        "description": "Descrição clara do parâmetro"
      }
    },
    "required": ["param"]
  },
  "script": "scripts/main.py",
  "runtime": "python"
}
```

### Passo 5: Chamar create_skill

```
Use: create_skill com todos os campos:
  - name, description, runtime, triggers, tags
  - instructions (markdown detalhado para o agente)
  - scripts (array com filename e content)
  - tools (array com JSON Schema)
  - dependencies_pip (se precisar de libs Python)
```

### Passo 6: Validar

```
Use: validate_skill com o nome da skill criada
```

Se houver erros, corrija e recrie com create_skill (ele sobrescreve).

### Passo 7: Ativar
Informe ao usuário que a skill foi criada e que precisa usar `/reload` no Telegram para ativá-la.

## ⚠️ Regras IMPORTANTES

### Scripts
- **SEMPRE** leia do stdin com `sys.stdin.read()` (Python) ou `process.stdin` (Node)
- **SEMPRE** retorne JSON no stdout com `print(json.dumps(result))`
- **SEMPRE** trate o campo `__tool__` para saber qual ferramenta chamou
- **SEMPRE** valide inputs e retorne `{"error": "mensagem"}` em caso de falha
- **NUNCA** use `input()` — scripts NÃO são interativos
- **NUNCA** imprima logs no stdout — use stderr para debug
- **NUNCA** hardcode API keys — use `os.environ.get('CHAVE')`
- **TIMEOUT**: 30s padrão, 5min máximo. Scripts lentos devem cachear resultados.

### Tool Definitions
- `name`: snake_case, descritivo (ex: `buscar_clima`, `gerar_resumo`)
- `description`: Detalhada! O LLM decide qual tool usar baseado NISTO
- `parameters.type`: SEMPRE "object"
- `parameters.properties`: Cada propriedade com type + description
- `parameters.required`: Lista de campos obrigatórios
- `script`: Caminho relativo ao dir da skill (ex: "scripts/main.py")

### Dependencies
- Prefira stdlib Python (urllib, json, os, subprocess, re, datetime)
- Se precisar de libs externas, liste em `dependencies_pip`
- Use version pinning quando possível (ex: "requests>=2.28")

### Triggers
- Seja específico (ex: "previsão do tempo", "clima")
- Evite triggers genéricos que conflitam com outras skills
- Mais triggers = ativação mais rápida (pula routing LLM)

### Instructions (corpo do SKILL.md)
- Explique QUANDO o agente deve usar esta skill
- Dê EXEMPLOS de uso (mensagens do usuário → resposta esperada)
- Defina o FORMATO da resposta
- Liste LIMITAÇÕES e edge cases

## 📦 Templates por Tipo

### Skill de API REST
```
dependencies_pip: ["requests>=2.28"]
Script pattern: requests.get(url, headers=auth) → parse JSON → return
Env vars: API_KEY no frontmatter api.envVars
```

### Skill de Processamento Local
```
dependencies_pip: [] (usa stdlib)
Script pattern: Lê input → processa → retorna resultado
Sem API externa
```

### Skill de Web Scraping
```
dependencies_pip: ["beautifulsoup4", "requests>=2.28"]
Script pattern: requests.get(url) → BeautifulSoup(html) → extract data
CUIDADO: sites podem bloquear, sempre trate erros HTTP
```

### Skill de Cálculo/Análise
```
dependencies_pip: ["numpy"] (se necessário)
Script pattern: Recebe dados → calcula → retorna resultado formatado
```

## 🔍 Integração com APIs

Quando o usuário quer integrar com uma API:

1. **Pesquise a API** — Entenda endpoints, auth, rate limits
2. **Configure auth** — Use `api_env_vars` para chaves
3. **Implemente retry** — Para erros 429/500/503
4. **Cache resultados** — Para economizar chamadas
5. **Trate todos os erros** — APIs caem sem aviso

Padrão recomendado com urllib (sem dependência):
```python
import urllib.request
import urllib.parse
import json
import os

API_KEY = os.environ.get('API_KEY', '')

def api_call(endpoint, params=None):
    url = f"https://api.example.com/v1/{endpoint}"
    if params:
        url += '?' + urllib.parse.urlencode(params)

    req = urllib.request.Request(url)
    req.add_header('Authorization', f'Bearer {API_KEY}')

    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        return {'error': f'API {e.code}: {e.reason}'}
    except Exception as e:
        return {'error': str(e)}
```

## 🚫 O que NÃO fazer

- NÃO crie skills sem scripts (prompt-only skills são inúteis para automação)
- NÃO crie skills com nomes genéricos como "util" ou "helper"
- NÃO coloque múltiplas funcionalidades não relacionadas na mesma skill
- NÃO ignore erros — retorne sempre JSON com campo "error"
- NÃO faça scripts que demoram mais de 30s sem motivo
- NÃO confie em URLs hardcoded — use configuração via env vars
