import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { layoutMindmap, parseMindmap } from '../../components/resources/mindmap-layout'

describe('mindmap preview layout', () => {
  it('parses Mermaid indentation and node shapes into a real hierarchy', () => {
    const nodes = parseMindmap(`mindmap
  root((库存超卖))
    表面现象
      库存只剩 1
      两人都下单成功
    真实缺口
      两个请求都读到 1`)

    assert.equal(nodes.length, 6)
    assert.equal(nodes[0].label, '库存超卖')
    assert.equal(nodes[1].parentId, nodes[0].id)
    assert.equal(nodes[2].parentId, nodes[1].id)
    assert.equal(nodes[5].depth, 2)
  })

  it('also accepts a Markdown outline and lays every node inside the viewBox', () => {
    const nodes = parseMindmap(`- 并发课题
  - 现象
    - 两次成功
  - 解法
    - 原子更新`)
    const layout = layoutMindmap(nodes)

    assert.equal(nodes.length, 5)
    assert.equal(layout.edges.length, 4)
    assert(layout.width >= 700)
    assert(layout.height >= 360)
    for (const node of layout.nodes) {
      assert(node.x - node.width / 2 >= 0)
      assert(node.x + node.width / 2 <= layout.width)
      assert(node.y - node.height / 2 >= 0)
      assert(node.y + node.height / 2 <= layout.height)
    }
  })
})
