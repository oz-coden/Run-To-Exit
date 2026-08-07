using UnityEngine;

namespace RunToExit.Core
{
    public class GridManager : MonoBehaviour
    {
        public static GridManager Instance { get; private set; }

        private void Awake()
        {
            if (Instance == null)
            {
                Instance = this;
            }
            else
            {
                Destroy(gameObject);
            }
        }

        // 整数座標での障害物チェック
        public Collider2D GetObjectAt(Vector2Int gridPos)
        {
            Collider2D[] hits = Physics2D.OverlapPointAll(new Vector2(gridPos.x, gridPos.y));
            if (hits.Length == 0) return null;

            // 優先的に壁や木箱などの足場を返す（他のトリガーなどに隠されないようにする）
            foreach (var hit in hits)
            {
                if (hit.CompareTag(TagName.Wall) || hit.GetComponent<MovableBox>() != null)
                {
                    return hit;
                }
            }
            return hits[0];
        }

        public bool IsWallAt(Vector2Int gridPos)
        {
            Collider2D col = GetObjectAt(gridPos);
            return col != null && col.CompareTag(TagName.Wall);
        }

        public T GetComponentAt<T>(Vector2Int gridPos) where T : Component
        {
            Collider2D col = GetObjectAt(gridPos);
            if (col != null)
            {
                return col.GetComponent<T>();
            }
            return null;
        }
    }
}
