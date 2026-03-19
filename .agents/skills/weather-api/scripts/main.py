#!/usr/bin/env python3
"""
BollaClaw Weather Skill — Main Script
Uses Open-Meteo API (free, no API key required)
Receives JSON args via stdin, outputs JSON result to stdout
"""

import sys
import json
import urllib.request
import urllib.parse
from datetime import datetime


def geocode(city: str) -> dict | None:
    """Get lat/lon for a city using Open-Meteo Geocoding API"""
    params = urllib.parse.urlencode({
        'name': city,
        'count': 1,
        'language': 'pt',
        'format': 'json'
    })
    url = f"https://geocoding-api.open-meteo.com/v1/search?{params}"

    try:
        with urllib.request.urlopen(url, timeout=10) as resp:
            data = json.loads(resp.read())
            if 'results' in data and len(data['results']) > 0:
                r = data['results'][0]
                return {
                    'name': r.get('name', city),
                    'country': r.get('country', ''),
                    'admin1': r.get('admin1', ''),
                    'latitude': r['latitude'],
                    'longitude': r['longitude'],
                    'timezone': r.get('timezone', 'America/Sao_Paulo'),
                }
    except Exception as e:
        print(json.dumps({'error': f'Geocoding failed: {str(e)}'}))
        return None

    return None


def get_current_weather(lat: float, lon: float, timezone: str = 'America/Sao_Paulo') -> dict:
    """Get current weather data from Open-Meteo"""
    params = urllib.parse.urlencode({
        'latitude': lat,
        'longitude': lon,
        'current': 'temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,rain,weather_code,wind_speed_10m,wind_direction_10m',
        'timezone': timezone,
    })
    url = f"https://api.open-meteo.com/v1/forecast?{params}"

    with urllib.request.urlopen(url, timeout=10) as resp:
        return json.loads(resp.read())


def get_forecast(lat: float, lon: float, days: int = 3, timezone: str = 'America/Sao_Paulo') -> dict:
    """Get weather forecast from Open-Meteo"""
    params = urllib.parse.urlencode({
        'latitude': lat,
        'longitude': lon,
        'daily': 'temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,weather_code,wind_speed_10m_max',
        'timezone': timezone,
        'forecast_days': min(days, 16),
    })
    url = f"https://api.open-meteo.com/v1/forecast?{params}"

    with urllib.request.urlopen(url, timeout=10) as resp:
        return json.loads(resp.read())


WMO_CODES = {
    0: 'Céu limpo', 1: 'Predominantemente limpo', 2: 'Parcialmente nublado',
    3: 'Nublado', 45: 'Nevoeiro', 48: 'Nevoeiro com geada',
    51: 'Garoa leve', 53: 'Garoa moderada', 55: 'Garoa forte',
    61: 'Chuva leve', 63: 'Chuva moderada', 65: 'Chuva forte',
    71: 'Neve leve', 73: 'Neve moderada', 75: 'Neve forte',
    80: 'Pancadas leves', 81: 'Pancadas moderadas', 82: 'Pancadas fortes',
    95: 'Trovoada', 96: 'Trovoada com granizo leve', 99: 'Trovoada com granizo forte',
}


def weather_description(code: int) -> str:
    return WMO_CODES.get(code, f'Código {code}')


def main():
    # Read args from stdin
    try:
        input_data = sys.stdin.read().strip()
        if input_data:
            args = json.loads(input_data)
        else:
            args = {}
    except json.JSONDecodeError:
        args = {}

    # Detect action from __tool__ name or explicit action param
    tool_name = args.get('__tool__', '')
    if 'forecast' in tool_name:
        action = 'forecast'
    elif 'current' in tool_name:
        action = 'current'
    else:
        action = args.get('action', 'current')

    city = args.get('city', 'São Paulo')
    days = args.get('days', 3)

    # Geocode the city
    location = geocode(city)
    if not location:
        print(json.dumps({'error': f'Cidade não encontrada: {city}'}))
        return

    result = {
        'city': location['name'],
        'country': location['country'],
        'state': location['admin1'],
        'coordinates': {
            'lat': location['latitude'],
            'lon': location['longitude'],
        },
    }

    try:
        if action == 'forecast':
            data = get_forecast(location['latitude'], location['longitude'], days, location['timezone'])
            daily = data.get('daily', {})
            forecast_days = []

            for i in range(len(daily.get('time', []))):
                forecast_days.append({
                    'date': daily['time'][i],
                    'temp_max': daily['temperature_2m_max'][i],
                    'temp_min': daily['temperature_2m_min'][i],
                    'precipitation_mm': daily['precipitation_sum'][i],
                    'precipitation_prob': daily['precipitation_probability_max'][i],
                    'weather': weather_description(daily['weather_code'][i]),
                    'weather_code': daily['weather_code'][i],
                    'wind_max_kmh': daily['wind_speed_10m_max'][i],
                })

            result['type'] = 'forecast'
            result['days'] = forecast_days

        else:
            data = get_current_weather(location['latitude'], location['longitude'], location['timezone'])
            current = data.get('current', {})

            result['type'] = 'current'
            result['current'] = {
                'temperature': current.get('temperature_2m'),
                'feels_like': current.get('apparent_temperature'),
                'humidity': current.get('relative_humidity_2m'),
                'precipitation_mm': current.get('precipitation', 0),
                'rain_mm': current.get('rain', 0),
                'weather': weather_description(current.get('weather_code', 0)),
                'weather_code': current.get('weather_code', 0),
                'wind_speed_kmh': current.get('wind_speed_10m'),
                'wind_direction': current.get('wind_direction_10m'),
                'time': current.get('time', ''),
            }

    except Exception as e:
        result['error'] = str(e)

    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
