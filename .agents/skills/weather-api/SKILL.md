---
name: weather-api
description: Consulta previsão do tempo e clima atual usando a API Open-Meteo (gratuita, sem API key)
version: "1.0"
author: BollaClaw
runtime: python
entrypoint: scripts/main.py
api:
  baseUrl: https://api.open-meteo.com/v1
  authType: none
dependencies:
  pip:
    - requests
triggers:
  - clima
  - tempo
  - previsão
  - chuva
  - temperatura
  - weather
  - vento
  - umidade
  - quente
  - frio
tags:
  - weather
  - api
  - utility
---

# Skill: Weather API

Você pode consultar o clima atual e previsão do tempo para qualquer cidade do mundo.

## Como usar

Quando o usuário perguntar sobre clima, tempo, previsão, temperatura, etc:

1. Use a ferramenta `weather_current` para buscar o clima atual de uma cidade
2. Use a ferramenta `weather_forecast` para buscar a previsão dos próximos dias

## Exemplos de uso

- "Como está o tempo em São Paulo?" → use `weather_current` com city="São Paulo"
- "Vai chover amanhã em Curitiba?" → use `weather_forecast` com city="Curitiba", days=2
- "Previsão da semana no Rio" → use `weather_forecast` com city="Rio de Janeiro", days=7

## Formato da resposta

Apresente os dados de forma clara e visual:
- Use emojis para representar condições (☀️ ☁️ 🌧️ ⛈️ ❄️ 💨)
- Temperaturas em Celsius
- Vento em km/h
- Probabilidade de chuva em %

## API

Usa a Open-Meteo API — gratuita e sem necessidade de API key.
