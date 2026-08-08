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
                    if (CanMoveTo(horizontalTarget, out MovableBox box, out NPCController npc, out InteractableBase interactable))
                    {
                        if (interactable != null && !interactable.IsObstacle(this))
                        {
                            interactable.OnInteract(this);
                        }
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

        public void MoveAndUseItem(Vector2Int targetPos)
        {
            if (!IsRescued || HeldItem == null) return;
            
            // アイテム使用は「対象の隣」から行うため、対象そのものの座標には行けない場合がある（炎など）
            // そのため、対象の隣接マスまでの経路を検索するなどの工夫が必要ですが、
            // 今回は簡略化のため、目標座標をそのままA*に渡し、A*側で到達不可なら近くまで行くか、
            // MoveAndUseItemコルーチン内で、目的地に近づいた時点でアイテムを使うようにします。
            
            if (followPathCoroutine != null) StopCoroutine(followPathCoroutine);
            followPathCoroutine = StartCoroutine(MoveAndUseRoutine(targetPos));
        }

        private System.Collections.IEnumerator MoveAndUseRoutine(Vector2Int targetInteractPos)
        {
            // 目標の隣（左右）のマスを探索の目的地にする
            // 本当はPathfinder側で「最寄りの隣接マス」を計算すべきですが、ここでは簡易的に対象とのX距離が1になるまで移動します。
            
            // とりあえず対象の座標をセット（障害物だとPathfinderが失敗する可能性があるため、実際のゲームでは工夫が必要）
            // 炎などは障害物なので、そのままではPathが見つからない。
            // そこで、対象の1歩手前を目的地として算出する。
            int dirX = targetInteractPos.x > GridPosition.x ? -1 : 1;
            Vector2Int standPos = new Vector2Int(targetInteractPos.x + dirX, targetInteractPos.y);
            
            System.Collections.Generic.List<Vector2Int> path = Pathfinder.FindPath(this, GridPosition, standPos);
            if (path != null && path.Count > 0)
            {
                yield return StartCoroutine(FollowPathRoutine(path));
            }
            
            // 移動完了後、ターゲット方向を向いてアイテムを使う
            if (State == CharacterState.Idle)
            {
                FacingDirection = targetInteractPos.x > GridPosition.x ? 1 : -1;
                Collider2D[] hits = Physics2D.OverlapPointAll(new Vector2(targetInteractPos.x, targetInteractPos.y));
                foreach (var hit in hits)
                {
                    var interactable = hit.GetComponent<InteractableBase>();
                    if (interactable != null)
                    {
                        UseItemOn(interactable);
                        break;
                    }
                }
            }
        }
    }
}
