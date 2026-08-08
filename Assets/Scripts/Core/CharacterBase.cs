using System.Collections;
using UnityEngine;

namespace RunToExit.Core
{
    public abstract class CharacterBase : MonoBehaviour
    {
        [Header("Character Stats")]
        public int Power = 1;
        public float MoveSpeed = 5f;
        public int ClimbLimit = 3;

        public enum CharacterState
        {
            Idle,
            Walking,
            Falling,
            Jumping,      // 段差ジャンプ(+1)
            Hanging,      // ぶら下がり
            Climbing,     // よじ登り
            LongJumping   // 幅跳び
        }

        public CharacterState State { get; protected set; } = CharacterState.Idle;
        public int FacingDirection { get; protected set; } = 1;

        protected float visualYOffset = 0f;

        protected virtual void Start()
        {
            // Y座標の初期オフセットを記録（MapGenerator等で+0.5された場合への対応）
            visualYOffset = transform.position.y - Mathf.Floor(transform.position.y);
        }

        public Vector2Int GridPosition => new Vector2Int(
            Mathf.RoundToInt(transform.position.x), 
            Mathf.RoundToInt(transform.position.y - visualYOffset)
        );

        public ItemType? HeldItem { get; protected set; }
        private GameObject heldItemVisual;

        // キャラクターは2マスサイズ（足元と頭上）
        public virtual bool CanMoveTo(Vector2Int targetPos, out MovableBox pushableBox, out NPCController npcHit, out InteractableBase interactable)
        {
            pushableBox = null;
            npcHit = null;
            interactable = null;

            Vector2Int footPos = targetPos;
            Vector2Int headPos = targetPos + Vector2Int.up;

            Collider2D hitFoot = GridManager.Instance.GetObjectAt(footPos);
            Collider2D hitHead = GridManager.Instance.GetObjectAt(headPos);

            // 自分自身は無視
            if (hitFoot != null && hitFoot.gameObject == gameObject) hitFoot = null;
            if (hitHead != null && hitHead.gameObject == gameObject) hitHead = null;

            if (hitFoot == null && hitHead == null) return true; // 空いている

            // 壁チェック
            if ((hitFoot != null && hitFoot.CompareTag(TagName.Wall)) || 
                (hitHead != null && hitHead.CompareTag(TagName.Wall)))
            {
                return false;
            }

            // 箱チェック
            if (hitFoot != null) pushableBox = hitFoot.GetComponent<MovableBox>();
            if (hitHead != null && pushableBox == null) pushableBox = hitHead.GetComponent<MovableBox>();

            if (pushableBox != null)
            {
                // 自分のパワーで箱を押せるか？（箱の先のマスが空いているかもチェック）
                if (Power >= pushableBox.RequiredPower && pushableBox.CanMoveTo(targetPos + (targetPos - GridPosition)))
                {
                    return true;
                }
                return false;
            }

            // 他の障害物（NPCなど）が居る場合も進めない
            bool footIsObstacle = false;
            bool headIsObstacle = false;

            if (hitFoot != null)
            {
                npcHit = hitFoot.GetComponent<NPCController>();
                var footInteractable = hitFoot.GetComponent<InteractableBase>();
                if (footInteractable != null)
                {
                    if (footInteractable.IsObstacle(this)) footIsObstacle = true;
                    else interactable = footInteractable;
                }
                else
                {
                    footIsObstacle = true; // 壁など
                }
            }
            
            if (hitHead != null)
            {
                if (npcHit == null) npcHit = hitHead.GetComponent<NPCController>();
                var headInteractable = hitHead.GetComponent<InteractableBase>();
                if (headInteractable != null)
                {
                    if (headInteractable.IsObstacle(this)) headIsObstacle = true;
                    else if (interactable == null) interactable = headInteractable;
                }
                else
                {
                    headIsObstacle = true; // 壁など
                }
            }

            if (footIsObstacle || headIsObstacle) return false;

            return true;
        }

        protected IEnumerator MoveRoutine(Vector2Int targetPos, MovableBox boxToPush = null)
        {
            State = CharacterState.Walking;

            if (boxToPush != null)
            {
                Vector2Int boxTarget = targetPos + (targetPos - GridPosition);
                boxToPush.PushTo(boxTarget);
            }

            int dirX = targetPos.x > GridPosition.x ? 1 : (targetPos.x < GridPosition.x ? -1 : 0);
            if (dirX != 0) FacingDirection = dirX;

            Vector3 endPos = new Vector3(targetPos.x, targetPos.y + visualYOffset, 0);
            while (Vector3.Distance(transform.position, endPos) > 0.01f)
            {
                transform.position = Vector3.MoveTowards(transform.position, endPos, MoveSpeed * Time.deltaTime);
                yield return null;
            }
            transform.position = endPos;
            State = CharacterState.Idle;

            CheckFall();
        }

        protected virtual void CheckFall()
        {
            // 足元の1マス下の確認
            Vector2Int below = GridPosition + Vector2Int.down;
            Collider2D hit = GridManager.Instance.GetObjectAt(below);
            
            // 下に何もない場合は落下
            if (hit == null)
            {
                StartCoroutine(FallRoutine());
            }
        }

        protected IEnumerator FallRoutine()
        {
            State = CharacterState.Falling;
            
            while (true)
            {
                Vector2Int below = GridPosition + Vector2Int.down;
                Collider2D hit = GridManager.Instance.GetObjectAt(below);
                
                // 着地判定（壁か箱などに乗る）
                if (hit != null && hit.gameObject != gameObject)
                {
                    break;
                }
                
                Vector3 endPos = transform.position + Vector3.down;
                while (Vector3.Distance(transform.position, endPos) > 0.01f)
                {
                    transform.position = Vector3.MoveTowards(transform.position, endPos, MoveSpeed * 1.5f * Time.deltaTime);
                    yield return null;
                }
                transform.position = endPos;
            }
            
            State = CharacterState.Idle;
            CheckFall(); // 連鎖的に落ちるかチェック
        }

        public virtual bool TryStepUp(Vector2Int targetPos)
        {
            // 段差ジャンプ（上へ1マス、横へ1マス）の判定
            // 現在の頭上（Y+2）と、移動先の頭上（Y+2）、移動先（Y+1）が空いているか確認
            Vector2Int currentAboveHead = GridPosition + Vector2Int.up * 2;
            Vector2Int targetStep = targetPos + Vector2Int.up;
            Vector2Int targetAboveHead = targetStep + Vector2Int.up;

            if (GridManager.Instance.GetObjectAt(currentAboveHead) != null) return false;
            if (GridManager.Instance.GetObjectAt(targetStep) != null) return false;
            if (GridManager.Instance.GetObjectAt(targetAboveHead) != null) return false;

            // 移動先の足元（本来のtargetPos）には足場（壁など）があるべき
            Collider2D footHit = GridManager.Instance.GetObjectAt(targetPos);
            if (!IsSolidPlatform(footHit)) return false;

            StartCoroutine(StepUpRoutine(targetStep));
            return true;
        }

        protected IEnumerator StepUpRoutine(Vector2Int targetStep)
        {
            State = CharacterState.Jumping;

            // まず真上に1マス上がる
            Vector3 upPos = transform.position + Vector3.up;
            while (Vector3.Distance(transform.position, upPos) > 0.01f)
            {
                transform.position = Vector3.MoveTowards(transform.position, upPos, MoveSpeed * 1.5f * Time.deltaTime);
                yield return null;
            }
            transform.position = upPos;

            // 次に横に1マス進む
            Vector3 forwardPos = new Vector3(targetStep.x, targetStep.y + visualYOffset, 0);
            while (Vector3.Distance(transform.position, forwardPos) > 0.01f)
            {
                transform.position = Vector3.MoveTowards(transform.position, forwardPos, MoveSpeed * 1.5f * Time.deltaTime);
                yield return null;
            }
            transform.position = forwardPos;

            State = CharacterState.Idle;
            CheckFall();
        }

        public virtual bool TryLongJump(int dirX)
        {
            // 最大3マスの幅跳びを試みる
            for (int dist = 2; dist <= 4; dist++) // dist=1は隣のマス(穴)、dist=2〜4(幅1〜3の穴の先)
            {
                Vector2Int landPos = GridPosition + new Vector2Int(dirX * dist, 0);
                Vector2Int belowLandPos = landPos + Vector2Int.down;

                Collider2D landHit = GridManager.Instance.GetObjectAt(landPos);
                Collider2D headHit = GridManager.Instance.GetObjectAt(landPos + Vector2Int.up);
                Collider2D belowHit = GridManager.Instance.GetObjectAt(belowLandPos);

                // 着地点自体が空いていて、その下が足場(着地可能)なら
                if (landHit == null && headHit == null && IsSolidPlatform(belowHit))
                {
                    // 間の空間が空いているかチェック
                    bool pathClear = true;
                    for (int i = 1; i < dist; i++)
                    {
                        Vector2Int pathPos = GridPosition + new Vector2Int(dirX * i, 0);
                        Vector2Int pathHeadPos = pathPos + Vector2Int.up;
                        if (GridManager.Instance.GetObjectAt(pathPos) != null || GridManager.Instance.GetObjectAt(pathHeadPos) != null)
                        {
                            pathClear = false;
                            break;
                        }
                    }

                    if (pathClear)
                    {
                        StartCoroutine(LongJumpRoutine(landPos));
                        return true;
                    }
                }
            }
            return false;
        }

        protected IEnumerator LongJumpRoutine(Vector2Int landPos)
        {
            State = CharacterState.LongJumping;
            if (landPos.x != GridPosition.x) FacingDirection = landPos.x > GridPosition.x ? 1 : -1;

            Vector3 startPos = transform.position;
            Vector3 endPos = new Vector3(landPos.x, landPos.y + visualYOffset, 0);
            float duration = Vector3.Distance(startPos, endPos) / (MoveSpeed * 1.5f);
            float elapsed = 0f;

            while (elapsed < duration)
            {
                elapsed += Time.deltaTime;
                float t = elapsed / duration;
                
                Vector3 currentPos = Vector3.Lerp(startPos, endPos, t);
                currentPos.y += Mathf.Sin(t * Mathf.PI) * 0.5f; // 放物線を描く

                transform.position = currentPos;
                yield return null;
            }

            transform.position = endPos;
            State = CharacterState.Idle;
            CheckFall();
        }

        public virtual bool TryLedgeGrab(int dirX)
        {
            // よじ登り（高さ2〜ClimbLimitマス）
            for (int h = 2; h <= ClimbLimit; h++)
            {
                Vector2Int grabWallPos = GridPosition + new Vector2Int(dirX, h - 1); // 壁の最上段
                Vector2Int standPos = GridPosition + new Vector2Int(dirX, h); // 登った後の立ち位置
                Vector2Int standHeadPos = standPos + Vector2Int.up;

                Collider2D wallHit = GridManager.Instance.GetObjectAt(grabWallPos);
                Collider2D standHit = GridManager.Instance.GetObjectAt(standPos);
                Collider2D headHit = GridManager.Instance.GetObjectAt(standHeadPos);

                // 壁が存在し、その上が空いていて、頭上も空いているか
                if (IsSolidPlatform(wallHit) && standHit == null && headHit == null)
                {
                    StartCoroutine(LedgeGrabRoutine(h, standPos));
                    return true;
                }
            }
            return false;
        }

        protected IEnumerator LedgeGrabRoutine(int height, Vector2Int standPos)
        {
            State = CharacterState.Hanging;
            
            // ぶら下がり位置（壁の側面に張り付くため真上に移動）
            Vector2Int hangGridPos = GridPosition + new Vector2Int(0, height - 1);
            Vector3 hangVisualPos = new Vector3(hangGridPos.x, hangGridPos.y + visualYOffset, 0);

            while (Vector3.Distance(transform.position, hangVisualPos) > 0.01f)
            {
                transform.position = Vector3.MoveTowards(transform.position, hangVisualPos, MoveSpeed * 1.5f * Time.deltaTime);
                yield return null;
            }
            transform.position = hangVisualPos;

            // よじ登り開始
            State = CharacterState.Climbing;

            Vector3 standVisualPos = new Vector3(standPos.x, standPos.y + visualYOffset, 0);
            while (Vector3.Distance(transform.position, standVisualPos) > 0.01f)
            {
                transform.position = Vector3.MoveTowards(transform.position, standVisualPos, MoveSpeed * 1.5f * Time.deltaTime);
                yield return null;
            }
            transform.position = standVisualPos;

            State = CharacterState.Idle;
            CheckFall();
        }

        protected bool IsSolidPlatform(Collider2D hit)
        {
            if (hit == null) return false;
            if (hit.CompareTag(TagName.Wall)) return true;
            if (hit.GetComponent<MovableBox>() != null) return true;
            return false;
        }

        public void PickUpItem(ItemBase item)
        {
            HeldItem = item.itemType;
            Debug.Log($"{gameObject.name} picked up {HeldItem}");

            // 見た目の設定（頭上に表示）
            if (heldItemVisual == null)
            {
                heldItemVisual = new GameObject("HeldItemVisual");
                heldItemVisual.transform.SetParent(transform);
                heldItemVisual.transform.localPosition = new Vector3(0, 1.5f, 0); // 頭上
                var sr = heldItemVisual.AddComponent<SpriteRenderer>();
                sr.sprite = item.GetComponent<SpriteRenderer>()?.sprite; // 同じスプライトをコピー
                sr.sortingOrder = 10;
                
                var col = heldItemVisual.AddComponent<BoxCollider2D>();
                col.isTrigger = true;
                var icon = heldItemVisual.AddComponent<HeldItemIcon>();
                icon.Owner = this;
            }
            else
            {
                heldItemVisual.SetActive(true);
                heldItemVisual.GetComponent<SpriteRenderer>().sprite = item.GetComponent<SpriteRenderer>()?.sprite;
            }

            // 元のアイテムオブジェクトは消す
            Destroy(item.gameObject);
        }

        public void UseItemOn(InteractableBase target)
        {
            if (HeldItem == null) return;

            if (HeldItem == ItemType.Extinguisher && target is FireHazard fire)
            {
                fire.Extinguish();
                // 使い捨てとする場合
                HeldItem = null;
                if (heldItemVisual != null) heldItemVisual.SetActive(false);
            }
            // 他のアイテム使用ロジックもここに追加
        }
    }
}
