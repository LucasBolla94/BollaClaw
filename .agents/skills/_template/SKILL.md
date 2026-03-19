---
# ============================================================
# BollaClaw Skill Template
# ============================================================
# Copie esta pasta, renomeie e customize para criar uma nova skill.
#
# Campos obrigatórios:
#   name         — Nome único da skill (kebab-case)
#   description  — O que esta skill faz (1 frase)
#
# Campos opcionais:
#   version      — Versão da skill
#   author       — Quem criou
#   runtime      — python | node | bash (auto-detectado se omitido)
#   entrypoint   — Script principal (default: scripts/main.py)
#   dependencies — Pacotes necessários (pip, npm, apt)
#   api          — Configuração de API externa
#   triggers     — Palavras-chave para matching rápido (sem LLM)
#   tags         — Categorias para organização
# ============================================================

name: minha-skill
description: Descreva aqui o que sua skill faz em uma frase
version: "1.0"
author: SeuNome

# Runtime: python | node | bash (auto-detectado pelo arquivo principal)
runtime: python
entrypoint: scripts/main.py

# Dependências que serão instaladas automaticamente na primeira execução
dependencies:
  pip:
    - requests
  # npm:
  #   - axios
  # apt:
  #   - imagemagick

# Se sua skill usa uma API externa, configure aqui
# api:
#   baseUrl: https://api.example.com/v1
#   authType: bearer          # bearer | api_key | basic | none
#   envVars:                  # Variáveis de ambiente necessárias
#     - MY_API_KEY

# Triggers: palavras que ativam esta skill SEM precisar chamar o LLM
# Quanto mais triggers, mais rápido o matching (evita 1 chamada LLM)
triggers:
  - palavra1
  - palavra2
  - palavra3

tags:
  - utility
---

# Skill: Minha Skill

Instruções para o agente sobre como usar esta skill.

## Quando usar

Descreva situações em que o agente deve ativar esta skill.

## Como usar

1. Passo 1
2. Passo 2
3. Passo 3

## Ferramentas disponíveis

Se a skill tem ferramentas (tools/), liste e explique cada uma aqui:

- **nome_ferramenta**: O que faz e quando usar

## Formato da resposta

Descreva como o agente deve formatar a resposta para o usuário.
