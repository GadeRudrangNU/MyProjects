import ast
import math
import operator

_BIN = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.Mod: operator.mod,
    ast.Pow: operator.pow,
}
_CMP = {
    ast.Eq: operator.eq,
    ast.NotEq: operator.ne,
    ast.Lt: operator.lt,
    ast.LtE: operator.le,
    ast.Gt: operator.gt,
    ast.GtE: operator.ge,
}
_FUNCS = {"abs": abs, "min": min, "max": max, "round": round, "sqrt": math.sqrt}


class ExprError(ValueError):
    pass


def parse(expr: str) -> ast.Expression:
    try:
        tree = ast.parse(expr.strip(), mode="eval")
    except SyntaxError as e:
        raise ExprError(f"invalid expression: {e.msg}") from None
    _check(tree.body)
    return tree


def _check(node: ast.AST):
    if isinstance(node, ast.BoolOp):
        for v in node.values:
            _check(v)
    elif isinstance(node, ast.BinOp) and type(node.op) in _BIN:
        _check(node.left)
        _check(node.right)
    elif isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.USub, ast.UAdd, ast.Not)):
        _check(node.operand)
    elif isinstance(node, ast.Compare) and all(type(o) in _CMP for o in node.ops):
        _check(node.left)
        for c in node.comparators:
            _check(c)
    elif isinstance(node, ast.Constant) and isinstance(node.value, (int, float, str, bool)) or isinstance(node, ast.Name):
        return
    elif isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in _FUNCS and not node.keywords:
        for a in node.args:
            _check(a)
    else:
        raise ExprError(f"unsupported syntax in expression: {type(node).__name__}")


def names(expr: str) -> set[str]:
    return {n.id for n in ast.walk(parse(expr)) if isinstance(n, ast.Name) and n.id not in _FUNCS}


def evaluate(expr: str, ctx: dict):
    return _eval(parse(expr).body, ctx)


def _eval(node: ast.AST, ctx: dict):
    if isinstance(node, ast.Constant):
        return node.value
    if isinstance(node, ast.Name):
        if node.id in ctx:
            return ctx[node.id]
        raise ExprError(f"unknown name '{node.id}'")
    if isinstance(node, ast.BoolOp):
        vals = (_eval(v, ctx) for v in node.values)
        return all(vals) if isinstance(node.op, ast.And) else any(vals)
    if isinstance(node, ast.UnaryOp):
        v = _eval(node.operand, ctx)
        if isinstance(node.op, ast.Not):
            return not v
        return -v if isinstance(node.op, ast.USub) else +v
    if isinstance(node, ast.BinOp):
        return _BIN[type(node.op)](_eval(node.left, ctx), _eval(node.right, ctx))
    if isinstance(node, ast.Compare):
        left = _eval(node.left, ctx)
        for op, comp in zip(node.ops, node.comparators):
            right = _eval(comp, ctx)
            if not _CMP[type(op)](left, right):
                return False
            left = right
        return True
    if isinstance(node, ast.Call):
        return _FUNCS[node.func.id](*[_eval(a, ctx) for a in node.args])
    raise ExprError("unsupported expression")
