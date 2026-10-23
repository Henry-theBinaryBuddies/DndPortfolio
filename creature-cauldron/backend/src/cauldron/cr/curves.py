"""Small curve tools for the CR estimator: a never-decreasing fit, filling empty steps, and reading a curve backwards.

A "curve" here is just a list of numbers, one per step of the challenge rating ladder (position 0 is CR 0, position 1
is CR 1/8, and so on), so a curve of hit points says how many hit points a typical monster has at each CR.
"""


def isotonic_fit(values: list[float], weights: list[int]) -> list[float]:
    """The closest never-decreasing list to `values`, where each value counts `weights[i]` times.

    This is "pool adjacent violators": walk along the list, and whenever a value is lower than the one before it,
    merge the two into their weighted average, repeating backwards until the list rises again. A CR can only get
    harder as the numbers grow, so a curve that dips (because one CR happened to hold some weak monsters) is
    smoothed rather than trusted.
    """
    if len(values) != len(weights):
        raise ValueError("values and weights must be the same length")
    # Each block is [average, total weight, how many positions it covers].
    blocks: list[list[float]] = []
    for value, weight in zip(values, weights, strict=True):
        blocks.append([value, float(weight), 1])
        while len(blocks) > 1 and blocks[-2][0] > blocks[-1][0]:
            top = blocks.pop()
            below = blocks.pop()
            total = below[1] + top[1]
            blocks.append([(below[0] * below[1] + top[0] * top[1]) / total, total, below[2] + top[2]])
    fitted: list[float] = []
    for average, _, count in blocks:
        fitted.extend([average] * int(count))
    return fitted


def fill_gaps(values: list[float | None]) -> list[float]:
    """Replaces None with a straight line between the nearest known neighbours. Ends copy the nearest known value."""
    known = [i for i, v in enumerate(values) if v is not None]
    if not known:
        raise ValueError("no known values to fill from")
    filled: list[float] = []
    for i, value in enumerate(values):
        if value is not None:
            filled.append(value)
            continue
        before = max((k for k in known if k < i), default=None)
        after = min((k for k in known if k > i), default=None)
        if before is None:
            filled.append(values[after])  # type: ignore[arg-type]
        elif after is None:
            filled.append(values[before])  # type: ignore[arg-type]
        else:
            start, end = values[before], values[after]
            filled.append(start + (end - start) * (i - before) / (after - before))  # type: ignore[operator]
    return filled


def invert(curve: list[float], value: float) -> float:
    """The (fractional) position at which a never-decreasing curve reaches `value`.

    Below the curve gives 0 and above it gives the last position. Inside a flat stretch the middle of the stretch is
    returned, since every position there is equally good.
    """
    if value <= curve[0]:
        # A flat start: use the middle of it, so the answer is not biased to the first step.
        end = max(i for i, v in enumerate(curve) if v == curve[0])
        return end / 2 if value == curve[0] else 0.0
    if value >= curve[-1]:
        start = min(i for i, v in enumerate(curve) if v == curve[-1])
        return (start + len(curve) - 1) / 2 if value == curve[-1] else float(len(curve) - 1)
    flat = [i for i, v in enumerate(curve) if v == value]
    if flat:
        return (flat[0] + flat[-1]) / 2
    for i in range(len(curve) - 1):
        low, high = curve[i], curve[i + 1]
        if low < value < high:
            return i + (value - low) / (high - low)
    raise AssertionError("unreachable: the curve is never decreasing")  # pragma: no cover
