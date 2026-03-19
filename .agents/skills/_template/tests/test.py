#!/usr/bin/env python3
"""
Testes para a skill.
Execute: python3 tests/test.py
"""

import subprocess
import json
import sys
import os


def run_script(args: dict) -> dict:
    """Helper: executa o script principal e retorna o JSON de saída"""
    script_path = os.path.join(os.path.dirname(__file__), '..', 'scripts', 'main.py')
    result = subprocess.run(
        ['python3', script_path],
        input=json.dumps(args),
        capture_output=True,
        text=True,
        timeout=30,
    )
    if result.returncode != 0:
        print(f"STDERR: {result.stderr}", file=sys.stderr)
        return {'error': f'Exit code {result.returncode}: {result.stderr}'}
    return json.loads(result.stdout)


def test_minha_ferramenta():
    """Testa a ferramenta principal"""
    result = run_script({
        '__tool__': 'minha_ferramenta',
        'param1': 'teste',
    })
    assert 'error' not in result, f"Erro: {result.get('error')}"
    assert result.get('status') == 'success', f"Status inesperado: {result}"
    print("✅ test_minha_ferramenta passed")


def test_ferramenta_desconhecida():
    """Testa handling de ferramenta inexistente"""
    result = run_script({
        '__tool__': 'nao_existe',
    })
    assert 'error' in result, "Deveria retornar erro para ferramenta desconhecida"
    print("✅ test_ferramenta_desconhecida passed")


if __name__ == '__main__':
    test_minha_ferramenta()
    test_ferramenta_desconhecida()
    print("\n🎉 Todos os testes passaram!")
