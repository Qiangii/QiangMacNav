import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/components/desktopSearch.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } });
const { DEFAULT_DESKTOP_SEARCH, searchURL, searchEngineError, desktopSearchLayout, saveDesktopSearch, isSearchGeometry, resizeDesktopSearch, searchOccupiedCells, SEARCH_HEIGHT } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
const gridSource = await readFile(new URL('../src/components/desktopGrid.ts', import.meta.url), 'utf8');
const gridModule = ts.transpileModule(gridSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const { desktopGrid, desktopGroupOffset, moveDesktopGroup, projectDesktopItems } = await import(`data:text/javascript;base64,${Buffer.from(gridModule).toString('base64')}`);

test('four default engines match the API, use bundled icons and encode each search query', async () => {
  const backend = await readFile(new URL('../server/desktop_search.go', import.meta.url), 'utf8');
  assert.deepEqual(DEFAULT_DESKTOP_SEARCH, JSON.parse(backend.match(/const defaultDesktopSearch = `([^`]+)`/)[1]));
  const catalog = JSON.parse(await readFile(new URL('../public/assets/icons/catalog.json', import.meta.url), 'utf8'));
  assert.deepEqual(catalog, JSON.parse(await readFile(new URL('../server/icon_catalog.json', import.meta.url), 'utf8')));
  assert.deepEqual(DEFAULT_DESKTOP_SEARCH.engines.map(engine => engine.id), ['google', 'twitter', 'baidu', 'bing']);
  const hosts = ['www.google.com', 'x.com', 'www.baidu.com', 'www.bing.com'];
  for (const [index, engine] of DEFAULT_DESKTOP_SEARCH.engines.entries()) {
    assert.match(engine.iconUrl, /^\/assets\/icons\//);
    assert.ok(catalog.items.some(item => item.url === engine.iconUrl), 'default icon must be allowed by the API');
    const bytes = await readFile(new URL(`../public${engine.iconUrl}`, import.meta.url));
    if (engine.iconUrl.endsWith('.png')) assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    else {
      assert.match(bytes.toString(), /^<svg /);
      assert.doesNotMatch(bytes.toString(), /<(?:script|image|foreignObject)\b|(?:href|onload)=/i);
    }
    const url = new URL(searchURL(engine, ' 中文 & a+b?# '));
    assert.equal(url.hostname, hosts[index]);
    assert.equal(url.searchParams.get(engine.id === 'baidu' ? 'wd' : 'q'), '中文 & a+b?#');
    assert.equal(url.searchParams.size, 1);
    assert.equal(url.hash, '');
  }
});

test('search replaces and encodes keywords without turning them into URL parameters', () => {
  assert.equal(searchURL(DEFAULT_DESKTOP_SEARCH.engines[0], ' 中文 & a+b?# '), 'https://www.google.com/search?q=%E4%B8%AD%E6%96%87%20%26%20a%2Bb%3F%23');
  assert.equal(searchURL(DEFAULT_DESKTOP_SEARCH.engines[1], ' '), '');
  for(const url of ['javascript:{query}', 'https://example.com/', 'https://{query}.example.com/', 'https://user:pass@example.com/?q={query}']) {
    assert.ok(searchEngineError({id:'x',name:'test',url}));
    assert.equal(searchURL({id:'x',name:'test',url},'hello'),'');
  }
});

test('search geometry is wider and centered by default, and moves without snapping', () => {
  const initial=desktopSearchLayout({width:1248,height:600},null);
  assert.equal(initial.x,344); assert.equal(initial.width,560); assert.ok(Math.abs(initial.y-109.6)<1e-9);
  const saved={x:317.5,y:153.25,width:577};
   assert.deepEqual(desktopSearchLayout({width:1248,height:600},saveDesktopSearch(saved,{width:1248,height:600})),saved);
  assert.deepEqual(desktopSearchLayout({width:304,height:700},null),{x:12,y:129.6,width:280});
  for(const value of [{x:-1,y:0,width:400},{x:1,y:NaN,width:400},{x:Infinity,y:1,width:400},{x:0,y:0,width:0},{x:'2',y:0,width:400},{column:2,row:1},'bad']) assert.equal(isSearchGeometry(value),false);
   assert.equal(isSearchGeometry(saved),false);
  assert.equal(isSearchGeometry(null),true);
  for (const bounds of [null,{}, {width:0,height:500},{width:1000,height:NaN},{width:'1000',height:500}]) assert.equal(isSearchGeometry({...saved,bounds}),false);
  assert.equal(isSearchGeometry(saveDesktopSearch(saved,{width:1248,height:600})),true);
});

test('relative geometry keeps width ratio and center/top anchors through shrinking and growing', () => {
  const bounds={width:1600,height:1052}, geometry={x:400,y:200,width:800};
  const saved=saveDesktopSearch(geometry,bounds);
  assert.deepEqual(desktopSearchLayout({width:800,height:552},saved),{x:200,y:100,width:400});
  assert.deepEqual(desktopSearchLayout({width:400,height:302},saved),{x:60,y:50,width:280});
  assert.deepEqual(desktopSearchLayout({width:200,height:40},saved),{x:0,y:0,width:200});
  assert.deepEqual(desktopSearchLayout(bounds,saved),geometry);
  assert.deepEqual(saved,{...geometry,bounds},'projection does not rewrite reference geometry');
  const moved=saveDesktopSearch({x:50,y:300,width:400},{width:800,height:552});
  assert.deepEqual(desktopSearchLayout(bounds,moved),{x:100,y:600,width:800},'a deliberate small-screen move becomes the new reference');
});

test('edge anchors and full-width widgets remain aligned at different sizes', () => {
  const bounds={width:1000,height:652};
  const right=saveDesktopSearch({x:500,y:600,width:500},bounds);
  assert.deepEqual(desktopSearchLayout({width:500,height:352},right),{x:220,y:300,width:280});
  const full=saveDesktopSearch({x:0,y:120,width:1000},bounds);
  assert.deepEqual(desktopSearchLayout({width:2000,height:1252},full),{x:0,y:240,width:2000});
});

test('viewport fitting preserves cached geometry and only width changes on resize', () => {
   const geometry={x:710,y:480,width:500};
   const saved=saveDesktopSearch(geometry,{width:1248,height:600});
  const small=desktopSearchLayout({width:304,height:450},saved);
   assert.equal(small.width,280);
   assert.ok(small.x>=0 && small.x+small.width<=304 && small.y+SEARCH_HEIGHT<=450);
   assert.deepEqual(desktopSearchLayout({width:1248,height:600},saved),geometry);
  for(const bounds of [{width:1248,height:600},{width:304,height:450},{width:200,height:100}]) {
    const box=desktopSearchLayout(bounds,saved);
    for(const dx of [-9999,-17,13,9999]) {
      const resized=resizeDesktopSearch(box,dx,bounds);
      assert.equal(resized.x,box.x); assert.equal(resized.y,box.y);
      assert.ok(resized.width>=Math.min(280,bounds.width-box.x));
      assert.ok(resized.x+resized.width<=bounds.width);
      assert.ok(resized.y+SEARCH_HEIGHT<=bounds.height);
    }
  }
  assert.deepEqual(resizeDesktopSearch({x:193,y:151,width:400},37,{width:1248,height:600}),{x:193,y:151,width:437});
});

test('free rectangles reserve partial cells and reject single or group drops after moving and resizing', () => {
  const items=[0,1,15,22].map((position,i)=>({kind:'site',id:String(i),position}));
  const grid=desktopGrid(960,600,items);
  const box={x:193,y:151,width:280};
  const cells=searchOccupiedCells(box,grid,100);
  assert.deepEqual([...cells],[12,13,14,22,23,24]);
  assert.deepEqual([...searchOccupiedCells({x:192,y:100,width:288},grid,100)],[12,13,14],'touching an edge is not overlap');
  const visible=projectDesktopItems(items,grid.columns,grid.columns,6,cells);
  assert.ok(visible.every(item=>!cells.has(item.position)));
  assert.equal(visible[2].position,15,'uncovered icon remains in place');
  assert.equal(new Set(visible.map(i=>i.position)).size,items.length);
  for(const keys of [new Set(['site:0']),new Set(['site:0','site:1'])]) {
    const blocked=desktopGroupOffset(visible,keys,{x:192,y:100},grid,cells);
    assert.equal(blocked.blocked,true);
    assert.equal(moveDesktopGroup(visible,keys,blocked,grid.columns),visible);
    const movedCells=searchOccupiedCells({...box,x:480},grid,100);
    assert.equal(desktopGroupOffset(visible,keys,{x:192,y:100},grid,movedCells).blocked,false,'moving away releases old cells');
  }
  const expanded=resizeDesktopSearch(box,200,{width:960,height:600});
  const widerCells=searchOccupiedCells(expanded,grid,100);
  assert.equal(cells.has(17),false); assert.equal(widerCells.has(17),true,'widening reserves new cells');
  const offset=desktopGroupOffset(visible,new Set(['site:0']),{x:672,y:100},grid,widerCells);
  assert.equal(offset.blocked,true);
  assert.deepEqual(items.map(i=>i.position),[0,1,15,22],'widget layout never mutates persisted icons');
});

test('mobile shortcuts stay below the whole search band through moving, resizing and overflow', () => {
  const items=Array.from({length:256},(_,i)=>({kind:'site',id:String(i),position:i===255?4095:i}));
  const original=structuredClone(items);
  for (const width of [304,374,728]) for (const y of [0,148,151,548]) {
    const grid=desktopGrid(width,600,items), box={x:12,y,width:280};
    const reserved=searchOccupiedCells(box,grid,100,true);
    const firstRow=Math.ceil((y+SEARCH_HEIGHT)/100);
    assert.equal(reserved.size,firstRow*grid.columns,'reserve full rows, including above and beside the widget');
    const projected=projectDesktopItems(items,10,grid.columns,6,reserved,6);
    assert.equal(new Set(projected.map(item=>item.position)).size,items.length);
    assert.ok(projected.every(item=>item.position>=firstRow*grid.columns && item.position<4096));
    assert.deepEqual(projectDesktopItems(projected,grid.columns,grid.columns,6,reserved,6),projected,'saving a mobile layout does not reflow it again');
    const resized=resizeDesktopSearch(box,150,{width,height:600});
    assert.deepEqual(searchOccupiedCells(resized,grid,100,true),reserved,'horizontal resizing keeps the full band reserved');
  }
  assert.deepEqual(items,original,'mobile projection keeps saved desktop anchors');
  assert.deepEqual(projectDesktopItems(items,10,10,6,new Set(),6),original,'disabling search or returning to the saved desktop restores anchors');
});

test('mobile dragging above or beside search is rejected while desktop reserves only its rectangle', () => {
  const items=[14,15].map((position,i)=>({kind:'site',id:String(i),position}));
  const grid=desktopGrid(728,600,items), box={x:224,y:148,width:280};
  const reserved=searchOccupiedCells(box,grid,100,true), keys=new Set(items.map(item=>`site:${item.id}`));
  for (const y of [-100,-200]) {
    const offset=desktopGroupOffset(items,keys,{x:0,y},grid,reserved);
    assert.equal(offset.blocked,true);
    assert.equal(moveDesktopGroup(items,keys,offset,grid.columns),items);
  }
  assert.equal(desktopGroupOffset(items,keys,{x:0,y:100},grid,reserved).blocked,false);
  assert.equal(desktopGroupOffset(items,keys,{x:0,y:-200},grid).blocked,false,'disabled search releases the band');
  const desktopReserved=searchOccupiedCells(box,grid,100);
  assert.equal(desktopGroupOffset(items,keys,{x:0,y:-100},grid,desktopReserved).blocked,false,'desktop icons can still sit beside search');
});
