#!/usr/bin/env python3
"""
BollaClaw Skill Script Template

Regras:
  - Recebe argumentos via stdin como JSON
  - Retorna resultado via stdout como JSON
  - Erros vão para stderr ou campo "error" no JSON
  - O campo __tool__ indica qual ferramenta chamou este script

Estrutura do JSON de entrada:
  {
    "__tool__": "nome_da_ferramenta",
    "param1": "valor1",
    "param2": "valor2"
  }

Estrutura do JSON de saída:
  {
    "result": "dados processados",
    "status": "success"
  }

  Ou em caso de erro:
  {
    "error": "mensagem de erro"
  }
"""

import sys
import json


def main():
    # 1. Ler argumentos do stdin
    try:
        input_data = sys.stdin.read().strip()
        args = json.loads(input_data) if input_data else {}
    except json.JSONDecodeError:
        args = {}

    # 2. Identificar qual ferramenta chamou
    tool_name = args.get('__tool__', 'unknown')

    # 3. Processar conforme a ferramenta
    try:
        if tool_name == 'minha_ferramenta':
            result = processar_minha_ferramenta(args)
        else:
            result = {'error': f'Ferramenta desconhecida: {tool_name}'}

    except Exception as e:
        result = {'error': str(e)}

    # 4. Retornar resultado como JSON
    print(json.dumps(result, ensure_ascii=False, indent=2))


def processar_minha_ferramenta(args: dict) -> dict:
    """Implemente sua lógica aqui"""
    param1 = args.get('param1', '')

    # TODO: Sua lógica aqui
    return {
        'status': 'success',
        'result': f'Processado: {param1}',
    }


if __name__ == '__main__':
    main()
