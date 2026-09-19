"""Validate and execute an operator supplied strategy in a bounded child process.

The restricted namespace and process limits reduce accidental misuse. They are
not a security boundary for hostile Python; only the trusted local operator may
submit code strategies on this single-user deployment.
"""
import ast
import json
import os
from pathlib import Path
import subprocess
import sys


class CodeStrategyError(ValueError):
    pass


_FORBIDDEN_NODES = (ast.Import, ast.ImportFrom, ast.Global, ast.Nonlocal)
_FORBIDDEN_NAMES = {
    "__builtins__", "__import__", "eval", "exec", "compile", "open", "input",
    "globals", "locals", "vars", "dir", "getattr", "setattr", "delattr",
    "breakpoint", "help", "memoryview", "super", "type", "object",
}


def validate_source(source: str) -> None:
    try:
        tree = ast.parse(source, mode="exec")
    except SyntaxError as exc:
        raise CodeStrategyError(f"策略代码语法错误：第 {exc.lineno} 行 {exc.msg}") from None
    classes = [node for node in tree.body if isinstance(node, ast.ClassDef)]
    if len(classes) != 1 or classes[0].name != "CustomStrategy":
        raise CodeStrategyError("代码必须且只能定义一个名为 CustomStrategy 的类")
    cls = classes[0]
    if len(cls.bases) != 1 or not isinstance(cls.bases[0], ast.Name) or cls.bases[0].id != "StrategyBase":
        raise CodeStrategyError("CustomStrategy 必须直接继承 StrategyBase")
    methods = [node for node in cls.body if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))]
    on_bar = [node for node in methods if node.name == "on_bar"]
    if len(on_bar) != 1 or isinstance(on_bar[0], ast.AsyncFunctionDef):
        raise CodeStrategyError("CustomStrategy 必须实现同步 on_bar(self, history) 方法")
    method = on_bar[0]
    if (len(method.args.posonlyargs) != 0 or len(method.args.args) != 2
            or [arg.arg for arg in method.args.args] != ["self", "history"]
            or method.args.vararg or method.args.kwarg or method.args.kwonlyargs):
        raise CodeStrategyError("on_bar 的参数必须严格为 (self, history)")
    for node in ast.walk(tree):
        if isinstance(node, _FORBIDDEN_NODES):
            raise CodeStrategyError("策略代码不支持 import、global 或 nonlocal")
        if isinstance(node, ast.Name) and (node.id in _FORBIDDEN_NAMES or node.id.startswith("__")):
            raise CodeStrategyError(f"策略代码包含不允许的名称：{node.id}")
        if isinstance(node, ast.Attribute) and node.attr.startswith("_"):
            raise CodeStrategyError("策略代码不能访问下划线开头的属性")


def run_signals(source: str, bars: list[dict]) -> list[str]:
    validate_source(source)
    payload = json.dumps({"source": source, "bars": bars}, ensure_ascii=False)
    script = Path(__file__).with_name("code_runner.py")
    # Do not pass database credentials or model keys to user code.
    child_env = {"PYTHONIOENCODING": "utf-8"}
    if os.name == "nt":
        for key in ("SYSTEMROOT", "WINDIR", "PATH"):
            if key in os.environ:
                child_env[key] = os.environ[key]
    try:
        completed = subprocess.run(
            [sys.executable, "-I", "-S", str(script)], input=payload,
            text=True, encoding="utf-8", capture_output=True, timeout=20,
            env=child_env, cwd=str(script.parent), check=False,
        )
    except subprocess.TimeoutExpired:
        raise CodeStrategyError("策略运行超过 20 秒限制") from None
    if completed.returncode != 0:
        raise CodeStrategyError("策略进程异常结束；请检查代码或资源用量")
    try:
        result = json.loads(completed.stdout)
    except (json.JSONDecodeError, ValueError):
        raise CodeStrategyError("策略进程未返回有效结果") from None
    if not isinstance(result, dict) or result.get("error"):
        raise CodeStrategyError(str(result.get("error", "策略运行失败"))[:300])
    signals = result.get("signals")
    if not isinstance(signals, list) or len(signals) != len(bars) or any(s not in ("BUY", "SELL", "HOLD") for s in signals):
        raise CodeStrategyError("策略信号结果无效")
    return signals
