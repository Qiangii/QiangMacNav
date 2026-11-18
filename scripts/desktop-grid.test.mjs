import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/components/desktopGrid.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } });
const { desktopGrid, desktopDropPosition, desktopKey, moveDesktopItem, projectDesktopItems, desktopGroupOffset, moveDesktopGroup } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
const zonesSource = await readFile(new URL('../src/components/desktopDropZones.ts', import.meta.url), 'utf8');
const zonesModule = ts.transpileModule(zonesSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } });
const { desktopDropBlocked } = await import(`data:text/javascript;base64,${Buffer.from(zonesModule.outputText).toString('base64')}`);

test('responsive grid keeps every shortcut reachable and non-overlapping', () => {
  const items = [0, 1, 8, 28, 4095].map((position, i) => ({kind:'site',id:String(i),position}));
  for (const width of [1, 288, 374, 768, 1248, 1920]) {
    const grid=desktopGrid(width, 600, items);
    const cells=items.map(item=>`${item.position%grid.columns}:${Math.floor(item.position/grid.columns)}`);
    assert.equal(new Set(cells).size, items.length);
    assert.ok(grid.cellWidth*grid.columns<=width+0.001);
    assert.ok(grid.rows>Math.floor(4095/grid.columns));
    for(const item of items) assert.equal(desktopDropPosition(item.position,{x:0,y:0},grid),item.position);
  }
});

test('drop snapping clamps edges, uses nearest cell, and preserves occupied slots by swapping', () => {
  const items=[{kind:'site',id:'a',position:0},{kind:'category',id:'b',position:1},{kind:'site',id:'c',position:5}];
  const grid=desktopGrid(960,600,items);
  assert.equal(desktopDropPosition(0,{x:47,y:49},grid),0);
  assert.equal(desktopDropPosition(0,{x:49,y:51},grid),11);
  assert.equal(desktopDropPosition(0,{x:-500,y:-900},grid),0);
  assert.equal(desktopDropPosition(0,{x:9999,y:9999},grid),59);
  for(let target=0;target<60;target++) {
    const result=moveDesktopItem(items,'site:a',target);
    assert.equal(new Set(result.map(item=>item.position)).size,3);
    assert.deepEqual(result.map(desktopKey),items.map(desktopKey));
    assert.equal(result[0].position,target);
    assert.deepEqual(items.map(item=>item.position),[0,1,5]);
  }
  assert.deepEqual(moveDesktopItem(items,'site:a',1).map(item=>item.position),[1,0,5]);
});

test('resizing preserves the second row and column, and restores anchors after narrowing', () => {
  const items = [{kind:'site',id:'a',position:11}, {kind:'category',id:'b',position:19}, {kind:'site',id:'c',position:21}];
  for (const columns of [5, 10, 16]) {
    const projected = projectDesktopItems(items, 10, columns, 6);
    assert.equal(projected[0].position, columns + 1, 'second row, second column');
    assert.equal(new Set(projected.map(i => i.position)).size, items.length);
  }
  // A removed column inserts at the rightmost available column and shifts only
  // its occupied chain. Returning to the saved viewport restores all anchors.
  assert.deepEqual(projectDesktopItems(items, 10, 2, 6).map(i => i.position), [5, 3, 7]);
  assert.deepEqual(projectDesktopItems(items, 10, 10, 6), items);
  assert.deepEqual(items.map(i => i.position), [11,19,21]);
});

test('narrow layouts and extreme saved positions stay reachable without overlaps', () => {
  const items = Array.from({length:256}, (_,i) => ({kind:'site',id:String(i),position:i===255?4095:i}));
  for (const savedColumns of [1,3,10,64]) for (const columns of [1,2,8,64]) for (const rows of [1,2,6,9]) {
    const projected=projectDesktopItems(items,savedColumns,columns,rows);
    assert.equal(new Set(projected.map(i => i.position)).size, items.length);
    assert.ok(projected.every(i=>i.position>=0 && i.position<4096));
    assert.deepEqual(projectDesktopItems(projected,columns,columns,rows,new Set(),rows),projected,'saving at this viewport must not reflow overflow again');
    const grid=desktopGrid(columns*96,600,projected);
    assert.ok(projected.every(i=>Math.floor(i.position/columns)<grid.rows));
    const moved=moveDesktopItem(projected,'site:0',projected[1].position);
    assert.equal(new Set(moved.map(i=>i.position)).size, items.length);
  }
});

test('ten rows shrink to nine: overflow inserts at the next column and stops at the first gap', () => {
  const items = [27,1,4,10,2].map((position,i)=>({kind:'site',id:String(i),position}));
  const small=projectDesktopItems(items,3,3,9,new Set(),10);
  assert.deepEqual(small.map(item=>item.position),[1,4,7,10,2]);
  assert.equal(small[3],items[3],'the icon after the gap is untouched');
  assert.deepEqual(projectDesktopItems(items,3,3,10,new Set(),10),items,'growing restores the saved tenth row');
  assert.deepEqual(items.map(item=>item.position),[27,1,4,10,2],'projection never overwrites saved positions');
});

test('multiple overflowing rows keep order and a collision chain continues across columns', () => {
  const items=[6,9,1,4,7,2,8].map((position,i)=>({kind:'site',id:String(i),position}));
  const projected=projectDesktopItems(items,3,3,3);
  assert.deepEqual(projected.map(item=>item.position),[6,1,4,7,2,5,8]);
  const two=[27,30,1,4,13].map((position,i)=>({kind:'site',id:String(i),position}));
  assert.deepEqual(projectDesktopItems(two,3,3,9).map(item=>item.position),[1,4,7,10,13]);
});

test('column overflow wraps to visible gaps, then uses scrollable space when full', () => {
  const sparse=[5,2].map((position,i)=>({kind:'site',id:String(i),position}));
  assert.deepEqual(projectDesktopItems(sparse,3,3,1).map(item=>item.position),[0,2]);
  const full=Array.from({length:8},(_,i)=>({kind:'site',id:String(i),position:i}));
  const small=projectDesktopItems(full,4,2,2);
  assert.equal(new Set(small.map(i=>i.position)).size,8);
  assert.ok([0,1,2,3].every(position=>small.some(item=>item.position===position)));
  assert.ok(small.some(item=>item.position>=4));
  assert.deepEqual(projectDesktopItems(small,2,2,2,new Set(),2),small);
});

test('search cells and height overflow share one insertion chain with stable ordering', () => {
  const items=[27,1,7,13,2].map((position,i)=>({kind:'site',id:String(i),position}));
  const reserved=new Set([1,4]);
  const projected=projectDesktopItems(items,3,3,9,reserved);
  assert.deepEqual(projected.map(item=>item.position),[7,10,13,16,2]);
  assert.ok(projected.every(item=>!reserved.has(item.position)));
  assert.equal(new Set(projected.map(item=>item.position)).size,items.length);
  assert.deepEqual(projectDesktopItems(projected,3,3,9,reserved,9),projected);
});

test('group movement preserves shape and exchanges occupants with vacated cells', () => {
  const items = [0,1,11,12,30].map((position,i)=>({kind:'site',id:String(i),position}));
  const keys = new Set(['site:0','site:1']);
  const grid = desktopGrid(960,600,items);
  const offset = desktopGroupOffset(items,keys,{x:96,y:100},grid);
  assert.deepEqual(offset,{x:96,y:100,column:1,row:1,blocked:false});
  const moved=moveDesktopGroup(items,keys,offset,grid.columns);
  assert.deepEqual(moved.map(i=>i.position),[11,12,0,1,30]);
  assert.deepEqual(items.map(i=>i.position),[0,1,11,12,30]);
  const overlap=moveDesktopGroup(items,keys,{column:1,row:0},10);
  assert.deepEqual(overlap.map(i=>i.position),[1,2,11,12,30]);
  assert.equal(moveDesktopGroup(items,keys,{column:0,row:0},10),items);
});

test('group boundaries clamp as a unit and never wrap rows or exceed stored position limit', () => {
  for (const width of [96,288,960,1248]) {
    const items=[0,1,12,28,4094,4095].map((position,i)=>({kind:'site',id:String(i),position}));
    const grid=desktopGrid(width,600,items);
    for(const indices of [[0],[0,1],[2,3],[4,5],[0,5]]) {
      const keys=new Set(indices.map(i=>desktopKey(items[i])));
      for(const delta of [{x:99999,y:999999},{x:-99999,y:-999999},{x:57,y:-154},{x:-65,y:250}]) {
        const offset=desktopGroupOffset(items,keys,delta,grid);
        const moved=moveDesktopGroup(items,keys,offset,grid.columns);
        assert.equal(new Set(moved.map(i=>i.position)).size,items.length);
        assert.ok(moved.every(i=>i.position>=0 && i.position<4096));
        for(const i of indices) {
          assert.equal(moved[i].position%grid.columns,items[i].position%grid.columns+offset.column);
          assert.equal(Math.floor(moved[i].position/grid.columns),Math.floor(items[i].position/grid.columns)+offset.row);
        }
      }
    }
  }
});

test('search widget reserves cells and shifts only the collided chain without overlapping a dragged group', () => {
  const items = [0,1,13,14,15,16,23,4095].map((position,i)=>({kind:'site',id:String(i),position}));
  const reserved = new Set([13,14,15,16]);
  const visible=projectDesktopItems(items,10,10,6,reserved,6);
  assert.ok(visible.every(i=>!reserved.has(i.position)));
  assert.equal(new Set(visible.map(i=>i.position)).size,items.length);
  assert.equal(visible[6].position,33,'the occupied cell below the search moves one row');
  assert.equal(visible[0].position,0,'unrelated icons stay in place');
  assert.deepEqual(items.map(i=>i.position),[0,1,13,14,15,16,23,4095]);
  const grid=desktopGrid(960,600,visible), keys=new Set(['site:0','site:1']);
  const offset=desktopGroupOffset(visible,keys,{x:3*grid.cellWidth,y:100},grid,reserved);
  assert.deepEqual(offset,{x:3*grid.cellWidth,y:100,column:3,row:1,blocked:true});
  const moved=moveDesktopGroup(visible,keys,offset,10);
  assert.equal(moved,visible,'a blocked group drop cancels without moving any item');
  assert.ok(moved.every(i=>!reserved.has(i.position)));
  assert.equal(new Set(moved.map(i=>i.position)).size,items.length);
  assert.equal(moved[1].position-moved[0].position,1);
  const edge=projectDesktopItems([{kind:'site',id:'x',position:4095}],10,10,6,new Set([4095]));
  assert.ok(edge[0].position>=0 && edge[0].position<60);
});

test('single or partial group collision stays under the pointer, then clears when leaving the widget', () => {
  const items=[0,1,29].map((position,i)=>({kind:'site',id:String(i),position}));
  const grid=desktopGrid(960,600,items), reserved=new Set([13,14,15,16]);
  for(const keys of [new Set(['site:0']),new Set(['site:0','site:1'])]) {
    const delta={x:3*grid.cellWidth+7,y:103};
    const blocked=desktopGroupOffset(items,keys,delta,grid,reserved);
    assert.equal(blocked.x,delta.x);
    assert.equal(blocked.y,delta.y);
    assert.equal(blocked.blocked,true);
    assert.equal(moveDesktopGroup(items,keys,blocked,10),items);
    const valid=desktopGroupOffset(items,keys,{...delta,y:203},grid,reserved);
    assert.equal(valid.blocked,false);
    assert.equal(moveDesktopGroup(items,keys,valid,10)[0].position,23);
    assert.equal(desktopGroupOffset(items,keys,delta,grid).blocked,false,'disabled widget releases its cells');
  }
  const partial=desktopGroupOffset(items,new Set(['site:0','site:1']),{x:192,y:100},grid,reserved);
  assert.equal(partial.blocked,true,'one member overlapping rejects the whole group');
});

test('visible windows reject the entire group if only a non-active member overlaps', () => {
  const items=[0,1,29].map((position,i)=>({kind:'site',id:String(i),position}));
  const grid=desktopGrid(960,600,items), keys=new Set(['site:0','site:1']);
  const viewport={left:16,top:16,width:960,height:600,scrollLeft:0,scrollTop:0};
  const window={left:304,top:116,width:200,height:300};
  const offset=desktopGroupOffset(items,keys,{x:192,y:100},grid);
  assert.equal(desktopDropBlocked(items,new Set(['site:0']),offset,grid,100,viewport,[window]),false);
  offset.blocked=desktopDropBlocked(items,keys,offset,grid,100,viewport,[window],{x:240,y:140});
  assert.equal(offset.blocked,true);
  assert.equal(moveDesktopGroup(items,keys,offset,10),items,'no movement or occupant swapping on rejection');
  const clear=desktopGroupOffset(items,keys,{x:192,y:0},grid);
  clear.blocked=desktopDropBlocked(items,keys,clear,grid,100,viewport,[window]);
  assert.equal(clear.blocked,false,'leaving the window restores a valid drop');
  assert.deepEqual(moveDesktopGroup(items,keys,clear,10).map(item=>item.position),[2,3,29]);
  assert.equal(desktopDropBlocked(items,keys,offset,grid,100,viewport,[]),false,'hidden windows release their region');
});

test('Dock pointer rejects a clamped icon even outside the desktop scroll viewport', () => {
  const items=[{kind:'site',id:'a',position:0}],keys=new Set(['site:a']);
  const grid=desktopGrid(960,600,items);
  const viewport={left:16,top:16,width:960,height:600,scrollLeft:0,scrollTop:0};
  const dock={left:300,top:720,width:400,height:68};
  const offset=desktopGroupOffset(items,keys,{x:400,y:740},grid);
  assert.equal(offset.y,500);
  assert.equal(desktopDropBlocked(items,keys,offset,grid,100,viewport,[dock]),false);
  offset.blocked=desktopDropBlocked(items,keys,offset,grid,100,viewport,[dock],{x:450,y:750});
  assert.equal(offset.blocked,true);
  assert.equal(moveDesktopGroup(items,keys,offset,10),items);
  assert.equal(desktopDropBlocked(items,keys,offset,grid,100,viewport,[dock],{x:200,y:750}),false,'empty space beside Dock is not a region');
});

test('window collision checks both preview and snapped destination with strict edge contact', () => {
  const items=[{kind:'site',id:'a',position:0}],keys=new Set(['site:a']);
  const grid=desktopGrid(960,600,items);
  const viewport={left:16,top:16,width:960,height:600,scrollLeft:0,scrollTop:0};
  const snapped=desktopGroupOffset(items,keys,{x:50,y:0},grid);
  assert.equal(desktopDropBlocked(items,keys,snapped,grid,100,viewport,[{left:200,top:16,width:10,height:100}]),true,'preview clear but snapped destination touches window');
  const moving=desktopGroupOffset(items,keys,{x:47,y:0},grid);
  assert.equal(desktopDropBlocked(items,keys,moving,grid,100,viewport,[{left:140,top:16,width:10,height:100}]),true,'preview overlaps before grid snapping changes');
  const origin=desktopGroupOffset(items,keys,{x:0,y:0},grid);
  assert.equal(desktopDropBlocked(items,keys,origin,grid,100,viewport,[{left:112,top:16,width:100,height:100}]),false,'adjacent edges do not overlap');
});

test('scrolled desktop uses viewport coordinates and excludes clipped group members', () => {
  const items=[0,20,90].map((position,i)=>({kind:'site',id:String(i),position}));
  const grid=desktopGrid(960,600,items),keys=new Set(items.map(desktopKey));
  const viewport={left:16,top:16,width:960,height:600,scrollLeft:0,scrollTop:200};
  const offset=desktopGroupOffset(items,keys,{x:0,y:0},grid);
  assert.equal(desktopDropBlocked(items,new Set(['site:1']),offset,grid,100,viewport,[{left:16,top:16,width:80,height:80}]),true);
  assert.equal(desktopDropBlocked(items,new Set(['site:0']),offset,grid,100,viewport,[{left:16,top:16,width:80,height:80}]),false);
  assert.equal(desktopDropBlocked(items,keys,offset,grid,100,viewport,[{left:16,top:720,width:600,height:68}]),false,'offscreen selection cannot overlap Dock through clipping');
  assert.equal(desktopDropBlocked(items,keys,offset,grid,100,{...viewport,scrollLeft:150},[{left:16,top:16,width:80,height:80}]),false);
});
