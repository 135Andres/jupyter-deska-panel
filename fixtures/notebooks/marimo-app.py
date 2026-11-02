import marimo

__generated_with = "0.9.0"
app = marimo.App(width="medium")


@app.cell
def _():
    import marimo as mo
    return (mo,)


@app.cell(hide_code=True)
def _(mo):
    mo.md(
        r"""
        # Slider demo

        Pick a value below.
        """
    )
    return


@app.cell
def data():
    values = [1, 2, 3]
    total = sum(values)
    total
    return total, values


@app.cell
def _(total):
    print(total * 2)
    return


if __name__ == "__main__":
    app.run()
