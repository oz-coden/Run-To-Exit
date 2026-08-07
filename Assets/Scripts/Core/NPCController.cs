using UnityEngine;

namespace RunToExit.Core
{
    public class NPCController : CharacterBase
    {
        public bool IsRescued { get; private set; } = false;

        protected override void Start()
        {
            base.Start();

            Power = 1;
            MoveSpeed = 4.5f; // プレイヤーより若干遅い
            ClimbLimit = 3; 

            // 未救出状態の見た目（グレーにするなど）
            var renderer = GetComponent<SpriteRenderer>();
            if (renderer != null)
            {
                renderer.color = Color.gray;
            }
        }

        public void Rescue()
        {
            if (IsRescued) return;
            
            IsRescued = true;
            Debug.Log($"{gameObject.name} is now rescued!");

            var renderer = GetComponent<SpriteRenderer>();
            if (renderer != null)
            {
                renderer.color = Color.white;
            }
        }

        private Coroutine followPathCoroutine;

        public void MoveTo(Vector2Int targetPos)
        {
            if (!IsRescued) return;

            System.Collections.Generic.List<Vector2Int> path = Pathfinder.FindPath(this, GridPosition, targetPos);
            if (path != null && path.Count > 0)
            {
                if (followPathCoroutine != null) StopCoroutine(followPathCoroutine);
                followPathCoroutine = StartCoroutine(FollowPathRoutine(path));
            }
            else
            {
                Debug.Log($"{gameObject.name}: Path not found to {targetPos}!");
                // 経路が見つからない場合、頭上に「？」フキダシを出す処理を追加予定
            }
        }

        private System.Collections.IEnumerator FollowPathRoutine(System.Collections.Generic.List<Vector2Int> path)
        {
            foreach (var nextPos in path)
            {
                int dirX = nextPos.x > GridPosition.x ? 1 : (nextPos.x < GridPosition.x ? -1 : 0);

                if (nextPos.y > GridPosition.y)
                {
                    // 段差ジャンプ
                    if (!TryStepUp(new Vector2Int(nextPos.x, GridPosition.y))) yield break; 
                }
                else
                {
                    // 横移動（落下含む）
                    Vector2Int horizontalTarget = new Vector2Int(nextPos.x, GridPosition.y);
                    if (CanMoveTo(horizontalTarget, out MovableBox box, out NPCController npc))
                    {
                        // 経路探索時点では箱がないか避けている前提
                        yield return StartCoroutine(MoveRoutine(horizontalTarget, box));
                    }
                    else
                    {
                        yield break;
                    }
                }

                // アクションが完了してIdleになるまで待機（落下中なども待つ）
                while (State != CharacterState.Idle)
                {
                    yield return null;
                }
            }
        }
    }
}
