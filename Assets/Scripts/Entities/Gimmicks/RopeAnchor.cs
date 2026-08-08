using System.Collections;
using UnityEngine;

namespace RunToExit.Core
{
    public class RopeAnchor : InteractableBase
    {
        private bool isUsed = false;

        public override void OnInteract(CharacterBase character)
        {
            if (isUsed)
            {
                Debug.Log("This rope anchor is already used.");
                return;
            }

            if (character.HeldItem == ItemType.Rope)
            {
                character.ConsumeItem();
                isUsed = true;
                StartCoroutine(SpawnLadderRoutine());
            }
            else
            {
                Debug.Log("You need a Rope to use this anchor.");
            }
        }

        private IEnumerator SpawnLadderRoutine()
        {
            if (MapGenerator.Instance == null || MapGenerator.Instance.ladderPrefab == null) yield break;

            Vector2Int currentCheckPos = GridPosition;
            int maxDepth = 20; // 無限ループ防止用の最大深度
            int depth = 0;

            // まず現在の位置（金具のマス）にハシゴを生成
            SpawnLadderAt(currentCheckPos);

            while (depth < maxDepth)
            {
                currentCheckPos += Vector2Int.down;
                GridNode node = GridManager.Instance.GetNode(currentCheckPos);
                
                // 地面にぶつかったら終了（他のハシゴなどがあれば上書きしないが下には続く可能性がある）
                // ただし、EXITでは地面に到達するまで伸びる
                if (node.Entities.Exists(e => e.IsSolidTo(null))) // 簡易的な障害物判定
                {
                    break;
                }

                SpawnLadderAt(currentCheckPos);
                depth++;
                yield return new WaitForSeconds(0.1f); // 梯子がパラパラと落ちていく演出
            }
        }

        private void SpawnLadderAt(Vector2Int gridPos)
        {
            if (GridManager.Instance.GetNode(gridPos).GetEntity<Ladder>() != null) return;

            Vector3 worldPos = new Vector3(MapGenerator.Instance.startPosition.x + gridPos.x, MapGenerator.Instance.startPosition.y + gridPos.y, 0);
            Object.Instantiate(MapGenerator.Instance.ladderPrefab, worldPos, Quaternion.identity);
        }
    }
}
