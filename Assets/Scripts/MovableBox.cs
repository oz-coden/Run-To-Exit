using System.Collections;
using UnityEngine;

public class MovableBox : Interactable
{
    public float moveSpeed = 5f;
    private bool isMoving = false;

    // 箱が進む先のマスが空いているかチェックする関数
    public bool CanMove(Vector3 direction)
    {
        Vector3 targetPos = transform.position + direction;
        
        // 進む先のマスに何かあるかチェック
        Collider2D hit = Physics2D.OverlapPoint(targetPos);
        
        if (hit != null)
        {
            // 壁や別の箱などがあれば進めない
            return false; 
        }
        return true; 
    }

    // プレイヤーから呼ばれる、箱を押し込む関数
    public void Push(Vector3 direction)
    {
        if (!isMoving)
        {
            StartCoroutine(MoveToGrid(direction));
        }
    }

    private IEnumerator MoveToGrid(Vector3 direction)
    {
        isMoving = true;
        Vector3 targetPosition = transform.position + direction;

        while (Vector3.Distance(transform.position, targetPosition) > 0.01f)
        {
            transform.position = Vector3.MoveTowards(transform.position, targetPosition, moveSpeed * Time.deltaTime);
            yield return null;
        }

        transform.position = targetPosition;
        isMoving = false;
    }
}