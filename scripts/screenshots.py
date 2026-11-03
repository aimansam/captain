"""Generate README screenshots, a demo GIF and the social preview from a DEMO=true instance.

    docker run -d --rm --name captain-demo -p 8788:8787 -e DEMO=true ghcr.io/aimansam/captain:latest
    python3 -I scripts/screenshots.py http://localhost:8788 docs
"""
import base64
import io
import sys
from pathlib import Path

from PIL import Image
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8788"
OUT = Path(sys.argv[2] if len(sys.argv) > 2 else "docs")
OUT.mkdir(parents=True, exist_ok=True)

W, H = 1280, 860


def login(page):
    page.goto(BASE)
    page.fill("input[type=password]", "demo")
    page.click("button[type=submit]")
    page.wait_for_selector(".row")
    page.wait_for_timeout(3500)  # let live stats populate


def new_page(browser, scheme, scale=2):
    ctx = browser.new_context(
        viewport={"width": W, "height": H}, color_scheme=scheme, device_scale_factor=scale
    )
    page = ctx.new_page()
    page.on("dialog", lambda d: d.accept())
    return ctx, page


def static_shots(browser):
    for scheme in ("dark", "light"):
        ctx, page = new_page(browser, scheme)
        login(page)
        page.screenshot(path=OUT / f"dashboard-{scheme}.png")
        if scheme == "dark":
            page.get_by_role("button", name="Cleanup").click()
            page.wait_for_selector(".modal")
            page.wait_for_timeout(400)
            page.screenshot(path=OUT / "cleanup.png")
            page.keyboard.press("Escape")
            page.locator('.group:has(h2:text-is("shop"))').get_by_role("button", name="Rebuild").click()
            page.wait_for_selector(".modal")
            page.get_by_text("Pull newer images first").click()
            page.get_by_role("button", name="Start rebuild").click()
            page.wait_for_timeout(3600)
            page.screenshot(path=OUT / "rebuild.png")
            page.wait_for_selector("text=Finished", timeout=15000)
            page.keyboard.press("Escape")
            page.locator('.row:has(.title:text-is("shop-api"))').get_by_title("Logs").click()
            page.wait_for_selector(".drawer pre")
            page.wait_for_timeout(500)
            page.screenshot(path=OUT / "logs.png")
        ctx.close()


def demo_gif(browser):
    ctx, page = new_page(browser, "dark", scale=1)
    page.set_viewport_size({"width": 1180, "height": 760})
    login(page)
    frames = []

    def snap(ms):
        img = Image.open(io.BytesIO(page.screenshot())).convert("RGB")
        img = img.resize((900, round(900 * img.height / img.width)), Image.LANCZOS)
        frames.append((img, ms))

    snap(1800)
    page.locator('.row:has(.title:text-is("jellyfin"))').locator(".switch").click()
    page.wait_for_timeout(700)
    snap(1500)
    page.locator('.group:has(h2:text-is("shop"))').get_by_role("button", name="Down").click()
    page.wait_for_timeout(1200)
    snap(1800)
    page.locator('.group:has(h2:text-is("shop"))').get_by_role("button", name="Up").click()
    page.wait_for_timeout(1500)
    snap(1500)
    page.get_by_role("button", name="Cleanup").click()
    page.wait_for_selector(".modal")
    page.wait_for_timeout(500)
    snap(2600)
    ctx.close()

    pal = [f.convert("P", palette=Image.ADAPTIVE, colors=128) for f, _ in frames]
    pal[0].save(
        OUT / "demo.gif", save_all=True, append_images=pal[1:],
        duration=[ms for _, ms in frames], loop=0, optimize=True,
    )


def social_preview(browser):
    shot = base64.b64encode((OUT / "dashboard-dark.png").read_bytes()).decode()
    html = f"""<html><body style="margin:0;width:1280px;height:640px;overflow:hidden;
      background:linear-gradient(135deg,#0d1117 0%,#12233f 100%);font-family:Inter,system-ui,sans-serif;color:#e6edf3">
      <div style="position:absolute;left:64px;top:150px;width:520px">
        <div style="font-size:84px;font-weight:700;letter-spacing:-2px">Captain</div>
        <div style="font-size:32px;line-height:1.3;margin-top:18px;color:#9db4d3">
          A tiny Docker dashboard that shows what's stale before you clean it.</div>
        <div style="margin-top:34px;font-size:22px;color:#4c8dff">start · stop · auto-start · safe cleanup</div>
      </div>
      <img src="data:image/png;base64,{shot}" style="position:absolute;left:640px;top:90px;width:1100px;
        border-radius:14px;border:1px solid #2a313c;box-shadow:0 30px 80px rgba(0,0,0,.6)"/>
      </body></html>"""
    page = browser.new_page(viewport={"width": 1280, "height": 640})
    page.set_content(html)
    page.wait_for_timeout(300)
    page.screenshot(path=OUT / "social-preview.png")
    page.close()


with sync_playwright() as p:
    browser = p.chromium.launch()
    static_shots(browser)
    social_preview(browser)
    demo_gif(browser)
    browser.close()
print("done:", sorted(x.name for x in OUT.iterdir()))
