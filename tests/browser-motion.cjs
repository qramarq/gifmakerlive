// Start the real app, then set GIFMAKER_TEST_URL and GIFMAKER_TEST_IMAGE.
const {chromium} = require('playwright');
const assert = require('node:assert/strict');

(async()=>{
  assert.ok(process.env.GIFMAKER_TEST_IMAGE);
  const browser=await chromium.launch({executablePath:process.env.GIFMAKER_TEST_BROWSER,channel:process.env.GIFMAKER_TEST_BROWSER?undefined:(process.env.BROWSER_CHANNEL || 'msedge'),headless:true,args:['--enable-unsafe-swiftshader']});
  try{
    const page=await browser.newPage({viewport:{width:1360,height:1200}});
    const errors=[]; page.on('pageerror',e=>errors.push(String(e)));
    const fallback=process.env.GIFMAKER_TEST_GPU_FALLBACK==='1';
    if(fallback) await page.route('**/wasm/**',route=>route.abort());
    await page.goto(process.env.GIFMAKER_TEST_URL || 'http://127.0.0.1:8776');
    if(!fallback) await page.frameLocator('#settings').locator('#loading').waitFor({state:'detached',timeout:90000});
    await page.locator('#animate-toggle').check();
    assert.equal(await page.locator('#motion-panel').isVisible(),true);
    assert.equal(await page.locator('#camera-tab').isVisible(),false);
    assert.equal(await page.locator('#original-size').isChecked(),true);
    await page.locator('#file').setInputFiles(process.env.GIFMAKER_TEST_IMAGE);
    await page.locator('[data-prompt="Gently float up and down"]').click();
    if(fallback){
      await page.locator('#duration').fill('2');
    }else{
      await page.locator('#settings').scrollIntoViewIfNeeded();
      const box=await page.locator('#settings').boundingBox();
      // Image mode adds duration beneath the width row. Wait for the GPU paint.
      for(let attempt=0;attempt<10;attempt++){
        await page.mouse.click(box.x+70,box.y+420);
        try{await page.waitForFunction(()=>document.querySelector('#duration').value==='2',null,{timeout:1000});break;}
        catch(e){if(attempt===9)throw e;}
      }
    }
    await page.locator('#convert').click();
    assert.equal(await page.locator('#animate-toggle').isDisabled(),true);
    await page.locator('#download').waitFor({state:'visible',timeout:150000});
    assert.match(await page.locator('#status').innerText(),/Loop ready/);
    const bytes=await page.locator('#download').evaluate(async a=>Array.from(new Uint8Array(await(await fetch(a.href)).arrayBuffer())));
    assert.ok(Buffer.from(bytes).includes(Buffer.from('NETSCAPE2.0')));
    assert.equal(await page.locator('#still').isVisible(),false);
    if(process.env.GIFMAKER_SCREENSHOT) await page.screenshot({path:process.env.GIFMAKER_SCREENSHOT,fullPage:true});
    await page.locator('#motion-prompt').fill('make the person wave');
    await page.locator('#convert').click();
    await page.waitForFunction(()=>document.querySelector('#status').classList.contains('error'));
    assert.match(await page.locator('#status').innerText(),/whole-image/);
    await page.setViewportSize({width:390,height:844});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    if(process.env.GIFMAKER_SCREENSHOT) await page.screenshot({path:process.env.GIFMAKER_SCREENSHOT.replace('.png','-mobile.png'),fullPage:true});
    await page.locator('#animate-toggle').uncheck();
    assert.equal(await page.locator('#camera-tab').isVisible(),true);
    assert.equal(await page.locator('#motion-panel').isVisible(),false);
    assert.equal(await page.locator('#convert').isDisabled(),true);
    assert.deepEqual(errors,[]);
    console.log(`PASS: image toggle, ${fallback?'HTML':'GPUI'} duration, real render/download, unsupported prompt, mobile layout, return to video`);
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
