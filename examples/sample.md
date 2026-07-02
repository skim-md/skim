# Glow Markdown Viewer

A sample document to exercise the renderer. This line has **bold**, *italic*,
~~strikethrough~~, and `inline code`.

## Hebrew & English (bidi)

שלום עולם! זהו טקסט בעברית שצריך להופיע מימין לשמאל.

This English paragraph stays left-to-right, while the one above it is RTL.

מספרים ו-English mixed: יש לי 3 apples ו-5 בננות.

> ציטוט בעברית עם פס בצד.
>
> An English blockquote with the bar on the left.

## Lists & tasks

- First bullet
- Second bullet
  - Nested item
- רשימה בעברית

1. Ordered one
2. Ordered two

- [x] Done task
- [ ] Pending task

## Math (LaTeX)

Inline: the mass–energy relation is $E = mc^2$, and $\alpha + \beta = \gamma$.

Block:

$$
\int_{-\infty}^{\infty} e^{-x^2}\,dx = \sqrt{\pi}
$$

$$
\frac{\partial u}{\partial t} = \nabla^2 u
$$

## Code

```js
function greet(name) {
  const msg = `Hello, ${name}!`;
  console.log(msg);
  return msg.length;
}
```

```python
def fib(n: int) -> int:
    a, b = 0, 1
    for _ in range(n):
        a, b = b, a + b
    return a
```

## Table

| Feature   | Supported |
| --------- | --------- |
| Images    | ✅        |
| LaTeX     | ✅        |
| Hebrew    | ✅        |

## Image

![Markdown logo](https://upload.wikimedia.org/wikipedia/commons/4/48/Markdown-mark.svg)

## Link

See [the Glow project](https://github.com/charmbracelet/glow).

---

That's the end of the sample.
