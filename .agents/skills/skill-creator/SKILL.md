---
name: skill-creator
description: Cria novas skills completas para o BollaClaw — pensa como um senior dev, estrutura, implementa, testa e efetiva
version: "1.0"
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
tags:
  - meta
  - development
  - automation
---

# Skill: Criador de Skills

Você é um engenheiro de software sênior especialista em criar skills para o BollaClaw.
Quando o usuário pedir para criar uma skill, você DEVE seguir este processo completo.

## 🧠 Mentalidade: Pense como um Especialista

Antes de escrever QUALQUER código:

1. **Entenda o domínio** — Pesquise e entenda profundamente o problema que a skill vai resolver.
   Se é uma skill de finanças, pense como um analista financeiro.
   Se é uma skill de marketing, pense como um growth hacker.
   Se é uma skill de DevOps, pense como um SRE sênior.

2. **Mapeie os requisitos** — O que exatamente precisa ser feito? Quais são os inputs e outputs?

3. **Escolha a melhor abordagem** — API pública? Scraping? Cálculo local? Banco de dados?

4. **Planeje a arquitetura** — Antes de codar, defina a estrutura dos arquivos, fluxo de dados, e tratamento de erros.

## 📁 Estrutura de uma Skill Completa

```
.agents/skills/
  minha-skill/
    SKILL.md            ← Instruções + frontmatter YAML (OBRIGATÓRIO)
    config.json         ← Configurações da skill (opcional)
    scripts/            ← Scripts executáveis (opcional, mas recomendado)
      main.py           ← Entry point Python (preferido)
      main.ts           ← ou Node/TypeScript
      helpers.py        ← Módulos auxiliares
    tools/              ← Ferramentas que o LLM pode chamar (opcional)
      buscar.json       ← Define uma tool chamável pelo agente
    tests/              ← Testes automatizados (OBRIGATÓRIO para skills complexas)
      test.py           ← Testes do script principal
    README.md           ← Documentação para desenvolvedores (opcional)
```

## 📋 Processo de Criação (6 Etapas)

### Etapa 1: Análise e Planejamento
- Entenda o que o usuário quer
- Pesquise APIs, documentações e abordagens disponíveis
- Se usar API de terceiros: leia a documentação oficial ANTES de codar
- Defina: inputs → processamento → outputs
- Liste edge cases e erros possíveis

### Etapa 2: Escrever o SKILL.md (Frontmatter + Instruções)
O SKILL.md é o "cérebro" da skill — diz ao agente COMO usar ela.

```yaml
---
name: nome-da-skill              # kebab-case, único
description: Uma frase clara     # O que a skill faz
version: "1.0"
author: SeuNome
runtime: python                  # python | node | bash
entrypoint: scripts/main.py
dependencies:
  pip:
    - requests                   # Pacotes Python necessários
  npm:
    - axios                      # Pacotes Node (se runtime: node)
api:
  baseUrl: https://api.example.com/v1
  authType: bearer               # bearer | api_key | basic | none
  envVars:
    - EXAMPLE_API_KEY            # Vars de ambiente que a skill precisa
triggers:
  - palavra1                     # Ativam a skill SEM chamar o LLM
  - palavra2                     # Mais triggers = roteamento mais rápido
tags:
  - categoria
---
```

O conteúdo após o frontmatter são as **instruções para o agente** — como um prompt especializado:
- Quando usar cada ferramenta
- Como formatar respostas
- Exemplos de uso
- Regras de negócio

### Etapa 3: Implementar os Scripts

Scripts são o "músculo" da skill — executam ações reais no servidor.

**Regras para scripts:**
- Recebem argumentos via **stdin como JSON**
- Retornam resultado via **stdout como JSON**
- O campo `__tool__` no JSON indica qual ferramenta chamou
- Erros vão para stderr ou campo `"error"` no JSON
- Timeout padrão: 30 segundos
- Máximo de output: 50KB

**Template Python:**
```python
#!/usr/bin/env python3
import sys, json

def main():
    args = json.loads(sys.stdin.read().strip() or '{}')
    tool = args.get('__tool__', '')

    if 'buscar' in tool:
        result = buscar(args)
    else:
        result = {'error': f'Tool desconhecida: {tool}'}

    print(json.dumps(result, ensure_ascii=False))

def buscar(args):
    # Sua lógica aqui
    return {'status': 'ok', 'data': '...'}

if __name__ == '__main__':
    main()
```

### Etapa 4: Definir Tools (Ferramentas)

Cada arquivo JSON em `tools/` vira uma ferramenta que o LLM pode invocar.

```json
{
  "name": "nome_ferramenta",
  "description": "O que faz — o LLM usa isso para decidir quando usar",
  "parameters": {
    "type": "object",
    "properties": {
      "query": {
        "type": "string",
        "description": "Texto para buscar"
      }
    },
    "required": ["query"]
  },
  "script": "scripts/main.py",
  "runtime": "python"
}
```

**Boas práticas para tools:**
- `name` deve ser descritivo e em snake_case
- `description` deve ser clara — o LLM decide qual tool usar baseado NISTO
- Parâmetros devem ter descriptions úteis
- Todas apontam para um script que sabe processar o `__tool__`

### Etapa 5: Testar

**NUNCA efetive uma skill sem testar.**

Crie `tests/test.py` que:
1. Chama o script principal com inputs conhecidos
2. Valida que o output está no formato esperado
3. Testa edge cases (input vazio, API fora do ar, dados inválidos)
4. Testa cada tool separadamente

```python
#!/usr/bin/env python3
import subprocess, json

def run(args):
    r = subprocess.run(['python3', 'scripts/main.py'],
        input=json.dumps(args), capture_output=True, text=True, timeout=30)
    return json.loads(r.stdout)

def test_busca():
    result = run({'__tool__': 'minha_busca', 'query': 'teste'})
    assert 'error' not in result
    assert 'data' in result
    print('✅ test_busca ok')

if __name__ == '__main__':
    test_busca()
```

### Etapa 6: Efetivar

Só depois de todos os testes passarem:
1. Mova a pasta da skill para `.agents/skills/`
2. Execute `/reload` no Telegram para recarregar
3. Teste no Telegram com uma mensagem real
4. Confirme ao usuário que a skill está ativa

## 🔌 Integração com APIs de Terceiros

Quando uma skill precisa usar uma API externa:

1. **Leia a documentação oficial** da API antes de implementar
2. **Use a URL da documentação** para entender: endpoints, autenticação, rate limits, formatos
3. **Configure auth via env vars** — NUNCA hardcode API keys no código
4. **Implemente retry** para erros temporários (429, 500, 503)
5. **Cache quando possível** para economizar chamadas
6. **Trate todos os erros** — APIs caem, retornam lixo, mudam sem aviso

**Padrão de integração API:**
```python
import urllib.request
import json
import os

API_KEY = os.environ.get('MINHA_API_KEY', '')
BASE_URL = 'https://api.servico.com/v1'

def api_call(endpoint, params=None):
    url = f"{BASE_URL}/{endpoint}"
    if params:
        url += '?' + urllib.parse.urlencode(params)

    req = urllib.request.Request(url)
    req.add_header('Authorization', f'Bearer {API_KEY}')
    req.add_header('Content-Type', 'application/json')

    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        return {'error': f'API error {e.code}: {e.reason}'}
    except Exception as e:
        return {'error': f'Request failed: {str(e)}'}
```

## ⚠️ Regras Importantes

- **NUNCA dependa de sites terceiros diretamente** — sempre use APIs oficiais
- **NUNCA hardcode credenciais** — use variáveis de ambiente
- **SEMPRE valide inputs** — o LLM pode enviar dados inesperados
- **SEMPRE trate erros** — scripts que crasham são inúteis
- **SEMPRE retorne JSON** — é o contrato entre script e agente
- **SEMPRE teste antes de efetivar** — uma skill quebrada é pior que nenhuma skill
- **Prefira Python** para scripts — é o runtime mais confiável no servidor
- **Use urllib (stdlib)** em vez de requests quando possível — evita dependências extras
